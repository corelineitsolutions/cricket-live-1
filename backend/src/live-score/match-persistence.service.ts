import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RedisKey } from '../common/constants/redis-keys';
import { logEvent } from '../common/utils/structured-log';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import type { LiveMatch, LiveTeam } from './live-match.types';

const FAILURE_COOLDOWN_MS = 60_000;

export interface PlayerSeed {
  sportmonksId: number;
  name: string | null;
  imageUrl: string | null;
}

/**
 * Writes match metadata to MySQL. Called only when a match first appears, changes
 * status, or finishes. Ball-by-ball score updates stay in Redis.
 */
@Injectable()
export class MatchPersistenceService {
  private readonly logger = new Logger(MatchPersistenceService.name);
  private readonly cooldownUntil = new Map<number, number>();
  private playersBlockedUntil = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Stores each player once. A Redis set remembers who is already in MySQL, so repeated
   * appearances in live data cause no database writes.
   */
  async persistPlayers(players: PlayerSeed[]): Promise<void> {
    if (this.playersBlockedUntil > Date.now()) {
      return;
    }
    for (const player of players) {
      if (!player.name || player.sportmonksId <= 0) {
        continue;
      }
      const member = String(player.sportmonksId);
      let isNew: boolean;
      try {
        isNew = await this.redis.addToSet(RedisKey.playersPersisted(), member);
      } catch {
        return;
      }
      if (!isNew) {
        continue;
      }
      try {
        await this.prisma.player.upsert({
          where: { sportmonksId: player.sportmonksId },
          create: { sportmonksId: player.sportmonksId, name: player.name, imageUrl: player.imageUrl },
          update: { name: player.name, ...(player.imageUrl ? { imageUrl: player.imageUrl } : {}) },
        });
      } catch (error) {
        await this.redis.removeFromSet(RedisKey.playersPersisted(), member).catch(() => undefined);
        this.playersBlockedUntil = Date.now() + FAILURE_COOLDOWN_MS;
        logEvent(this.logger, 'warn', 'player-persist-error', {
          sportmonksId: player.sportmonksId,
          error: error instanceof Error ? error.name : 'Unknown',
        });
        return;
      }
    }
  }

  shouldPersist(previous: LiveMatch | null, next: LiveMatch): boolean {
    if (!next.league || !next.season || !next.startTime) {
      return false;
    }
    const ids = [next.league.sportmonksId, next.season.sportmonksId, next.localTeam.sportmonksId, next.visitorTeam.sportmonksId];
    if (ids.some((id) => id === null || id <= 0)) {
      return false;
    }
    if (!previous || !previous.matchId) {
      return true;
    }
    return (
      previous.status !== next.status ||
      previous.isFinished !== next.isFinished ||
      previous.winnerTeamSportmonksId !== next.winnerTeamSportmonksId
    );
  }

  /** Returns the backend match id, or null when the write was skipped or failed. */
  async persist(match: LiveMatch): Promise<string | null> {
    const blockedUntil = this.cooldownUntil.get(match.sportmonksId) ?? 0;
    if (blockedUntil > Date.now()) {
      return null;
    }

    try {
      const id = await this.prisma.$transaction((tx) => this.upsert(tx, match));
      this.cooldownUntil.delete(match.sportmonksId);
      if (id) {
        logEvent(this.logger, 'log', 'match-persisted', {
          sportmonksId: match.sportmonksId,
          matchId: id,
          status: match.status,
        });
      }
      return id;
    } catch (error) {
      this.cooldownUntil.set(match.sportmonksId, Date.now() + FAILURE_COOLDOWN_MS);
      logEvent(this.logger, 'warn', 'match-persist-error', {
        sportmonksId: match.sportmonksId,
        error: error instanceof Error ? error.name : 'Unknown',
      });
      return null;
    }
  }

  private async upsert(tx: Prisma.TransactionClient, match: LiveMatch): Promise<string | null> {
    const league = match.league!;
    const season = match.season!;
    const startTime = new Date(match.startTime!);

    const leagueRow = await tx.league.upsert({
      where: { sportmonksId: league.sportmonksId },
      create: {
        sportmonksId: league.sportmonksId,
        name: league.name ?? `League ${league.sportmonksId}`,
        code: league.code,
        imageUrl: league.imageUrl,
      },
      update: {
        ...(league.name ? { name: league.name } : {}),
        ...(league.code ? { code: league.code } : {}),
        ...(league.imageUrl ? { imageUrl: league.imageUrl } : {}),
      },
    });

    const seasonRow = await tx.season.upsert({
      where: { sportmonksId: season.sportmonksId },
      create: {
        sportmonksId: season.sportmonksId,
        leagueId: leagueRow.id,
        name: season.name ?? `Season ${season.sportmonksId}`,
      },
      update: {
        leagueId: leagueRow.id,
        ...(season.name ? { name: season.name } : {}),
      },
    });

    const local = await this.upsertTeam(tx, match.localTeam);
    const visitor = await this.upsertTeam(tx, match.visitorTeam);
    const winnerTeamId =
      match.winnerTeamSportmonksId === match.localTeam.sportmonksId
        ? local.id
        : match.winnerTeamSportmonksId === match.visitorTeam.sportmonksId
          ? visitor.id
          : null;

    const data = {
      leagueId: leagueRow.id,
      seasonId: seasonRow.id,
      localTeamId: local.id,
      visitorTeamId: visitor.id,
      winnerTeamId,
      venueName: match.venue?.name ?? null,
      venueCity: match.venue?.city ?? null,
      status: match.status,
      statusDetail: match.statusDetail,
      matchType: match.matchType,
      round: match.round,
      startTime,
      resultSummary: match.isFinished ? match.note : null,
    };

    const row = await tx.match.upsert({
      where: { sportmonksId: match.sportmonksId },
      create: { sportmonksId: match.sportmonksId, ...data },
      update: data,
      select: { id: true },
    });
    return row.id;
  }

  private upsertTeam(tx: Prisma.TransactionClient, team: LiveTeam) {
    const sportmonksId = team.sportmonksId!;
    return tx.team.upsert({
      where: { sportmonksId },
      create: {
        sportmonksId,
        name: team.name ?? `Team ${sportmonksId}`,
        shortName: team.shortName,
        imageUrl: team.imageUrl,
      },
      update: {
        ...(team.name ? { name: team.name } : {}),
        ...(team.shortName ? { shortName: team.shortName } : {}),
        ...(team.imageUrl ? { imageUrl: team.imageUrl } : {}),
      },
      select: { id: true },
    });
  }
}
