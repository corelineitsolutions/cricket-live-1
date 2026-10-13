import { Prisma, PrismaClient } from '@prisma/client';
import { safeErrorMessage } from './safe-error';

/**
 * Rebuilds the hist_agg_* summary tables from the ball-by-ball tables. Every statement is a
 * fixed SQL string (no user or model input). All tables are replaced inside one transaction
 * so readers see either the previous or the new set. Super-over innings are excluded.
 */
const AGG_TX_TIMEOUT_MS = 60 * 60 * 1000;

const TEMP_TABLES = [
  `CREATE TEMPORARY TABLE tmp_hist_bat_inn (
     match_id INT NOT NULL, innings_no TINYINT UNSIGNED NOT NULL, person_id CHAR(8) NOT NULL,
     venue_id INT NOT NULL, match_type VARCHAR(8) NOT NULL, gender VARCHAR(16) NOT NULL, team_type VARCHAR(16) NOT NULL,
     start_date DATE NOT NULL, runs INT NOT NULL, balls INT NOT NULL, fours INT NOT NULL, sixes INT NOT NULL,
     is_out TINYINT NOT NULL,
     PRIMARY KEY (match_id, innings_no, person_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TEMPORARY TABLE tmp_hist_bowl_inn (
     match_id INT NOT NULL, innings_no TINYINT UNSIGNED NOT NULL, person_id CHAR(8) NOT NULL,
     venue_id INT NOT NULL, match_type VARCHAR(8) NOT NULL, gender VARCHAR(16) NOT NULL, team_type VARCHAR(16) NOT NULL,
     legal_balls INT NOT NULL, runs INT NOT NULL, wickets INT NOT NULL, dots INT NOT NULL,
     fours INT NOT NULL, sixes INT NOT NULL, wides INT NOT NULL, noballs INT NOT NULL,
     PRIMARY KEY (match_id, innings_no, person_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

const FILL_TEMP = [
  `INSERT INTO tmp_hist_bat_inn
   SELECT a.match_id, a.innings_no, a.person_id, m.venue_id, m.match_type, m.gender, m.team_type, m.start_date,
          COALESCE(s.runs, 0), COALESCE(s.balls, 0), COALESCE(s.fours, 0), COALESCE(s.sixes, 0),
          EXISTS (SELECT 1 FROM hist_wickets w
                  WHERE w.match_id = a.match_id AND w.innings_no = a.innings_no
                    AND w.player_out_id = a.person_id AND w.counts_as_team_wicket = 1)
   FROM (SELECT match_id, innings_no, batter_id AS person_id FROM hist_deliveries
         UNION
         SELECT match_id, innings_no, non_striker_id FROM hist_deliveries) a
   JOIN hist_innings i ON i.match_id = a.match_id AND i.innings_no = a.innings_no AND i.is_super_over = 0
   JOIN hist_matches m ON m.id = a.match_id
   LEFT JOIN (SELECT match_id, innings_no, batter_id,
                     SUM(runs_batter) AS runs, SUM(wides = 0) AS balls,
                     SUM(runs_batter = 4 AND non_boundary = 0) AS fours,
                     SUM(runs_batter = 6 AND non_boundary = 0) AS sixes
              FROM hist_deliveries GROUP BY match_id, innings_no, batter_id) s
     ON s.match_id = a.match_id AND s.innings_no = a.innings_no AND s.batter_id = a.person_id`,
  `INSERT INTO tmp_hist_bowl_inn
   SELECT d.match_id, d.innings_no, d.bowler_id, m.venue_id, m.match_type, m.gender, m.team_type,
          SUM(d.is_legal), SUM(d.runs_batter + d.wides + d.noballs), COALESCE(MAX(w.wickets), 0),
          SUM(d.is_legal = 1 AND d.runs_batter = 0),
          SUM(d.runs_batter = 4 AND d.non_boundary = 0), SUM(d.runs_batter = 6 AND d.non_boundary = 0),
          SUM(d.wides), SUM(d.noballs)
   FROM hist_deliveries d
   JOIN hist_innings i ON i.match_id = d.match_id AND i.innings_no = d.innings_no AND i.is_super_over = 0
   JOIN hist_matches m ON m.id = d.match_id
   LEFT JOIN (SELECT match_id, innings_no, bowler_id, COUNT(*) AS wickets
              FROM hist_wickets WHERE credited_to_bowler = 1
              GROUP BY match_id, innings_no, bowler_id) w
     ON w.match_id = d.match_id AND w.innings_no = d.innings_no AND w.bowler_id = d.bowler_id
   GROUP BY d.match_id, d.innings_no, d.bowler_id, m.venue_id, m.match_type, m.gender, m.team_type`,
];

const REBUILD: Array<{ table: string; insert: string }> = [
  {
    table: 'hist_agg_player_batting',
    insert: `INSERT INTO hist_agg_player_batting
      (person_id, match_type, gender, team_type, matches, innings, not_outs, runs, balls_faced, fours, sixes,
       highest, highest_not_out, fifties, hundreds, ducks, first_match_date, last_match_date)
      SELECT u.person_id, u.match_type, u.gender, u.team_type,
             SUM(u.matches), SUM(u.innings), SUM(u.not_outs), SUM(u.runs), SUM(u.balls), SUM(u.fours), SUM(u.sixes),
             COALESCE(FLOOR(MAX(u.best) / 2), 0), COALESCE(MAX(u.best) % 2 = 1, 0),
             SUM(u.fifties), SUM(u.hundreds), SUM(u.ducks), MIN(u.first_date), MAX(u.last_date)
      FROM (
        SELECT mp.person_id, m.match_type, m.gender, m.team_type, COUNT(*) AS matches, 0 AS innings, 0 AS not_outs,
               0 AS runs, 0 AS balls, 0 AS fours, 0 AS sixes, CAST(NULL AS SIGNED) AS best, 0 AS fifties,
               0 AS hundreds, 0 AS ducks, MIN(m.start_date) AS first_date, MAX(m.start_date) AS last_date
        FROM hist_match_players mp JOIN hist_matches m ON m.id = mp.match_id
        GROUP BY mp.person_id, m.match_type, m.gender, m.team_type
        UNION ALL
        SELECT t.person_id, t.match_type, t.gender, t.team_type, 0, COUNT(*), SUM(t.is_out = 0), SUM(t.runs),
               SUM(t.balls), SUM(t.fours), SUM(t.sixes), MAX(t.runs * 2 + (t.is_out = 0)),
               SUM(t.runs >= 50 AND t.runs < 100), SUM(t.runs >= 100), SUM(t.runs = 0 AND t.is_out = 1),
               MIN(t.start_date), MAX(t.start_date)
        FROM tmp_hist_bat_inn t GROUP BY t.person_id, t.match_type, t.gender, t.team_type
      ) u
      GROUP BY u.person_id, u.match_type, u.gender, u.team_type`,
  },
  {
    table: 'hist_agg_player_bowling',
    insert: `INSERT INTO hist_agg_player_bowling
      (person_id, match_type, gender, team_type, innings, legal_balls, runs_conceded, wickets, dots,
       fours_conceded, sixes_conceded, wides, noballs, best_wickets, best_runs, four_wickets, five_wickets)
      SELECT person_id, match_type, gender, team_type, COUNT(*), SUM(legal_balls), SUM(runs), SUM(wickets), SUM(dots),
             SUM(fours), SUM(sixes), SUM(wides), SUM(noballs),
             CEIL(MAX(wickets * 10000 - runs) / 10000),
             CEIL(MAX(wickets * 10000 - runs) / 10000) * 10000 - MAX(wickets * 10000 - runs),
             SUM(wickets = 4), SUM(wickets >= 5)
      FROM tmp_hist_bowl_inn GROUP BY person_id, match_type, gender, team_type`,
  },
  {
    table: 'hist_agg_venue',
    insert: `INSERT INTO hist_agg_venue
      (venue_id, match_type, gender, matches, result_matches, bat_first_wins, chasing_wins, ties, draws, no_results,
       first_innings_count, first_innings_runs, highest_total, lowest_all_out_total, toss_winner_wins, last_match_date)
      SELECT m.venue_id, m.match_type, m.gender, COUNT(*),
             SUM(m.outcome = 'WIN'),
             COALESCE(SUM(m.outcome = 'WIN' AND m.winner_id = i1.batting_team_id), 0),
             COALESCE(SUM(m.outcome = 'WIN' AND m.winner_id <> i1.batting_team_id), 0),
             SUM(m.outcome = 'TIE'), SUM(m.outcome = 'DRAW'), SUM(m.outcome = 'NO_RESULT'),
             COUNT(i1.match_id), COALESCE(SUM(i1.runs), 0), COALESCE(MAX(x.max_runs), 0), MIN(x.min_all_out),
             COALESCE(SUM(m.winner_id = m.toss_winner_id), 0), MAX(m.start_date)
      FROM hist_matches m
      LEFT JOIN hist_innings i1 ON i1.match_id = m.id AND i1.innings_no = 1 AND i1.is_super_over = 0
      LEFT JOIN (SELECT match_id, MAX(runs) AS max_runs, MIN(CASE WHEN wickets >= 10 THEN runs END) AS min_all_out
                 FROM hist_innings WHERE is_super_over = 0 GROUP BY match_id) x ON x.match_id = m.id
      GROUP BY m.venue_id, m.match_type, m.gender`,
  },
  {
    table: 'hist_agg_player_venue',
    insert: `INSERT INTO hist_agg_player_venue
      (person_id, venue_id, match_type, gender, batting_innings, runs, balls_faced, dismissals, highest,
       bowling_innings, legal_balls, runs_conceded, wickets)
      SELECT person_id, venue_id, match_type, gender, SUM(bi), SUM(r), SUM(b), SUM(o), MAX(h),
             SUM(boi), SUM(lb), SUM(rc), SUM(w)
      FROM (
        SELECT person_id, venue_id, match_type, gender, COUNT(*) AS bi, SUM(runs) AS r, SUM(balls) AS b,
               SUM(is_out) AS o, MAX(runs) AS h, 0 AS boi, 0 AS lb, 0 AS rc, 0 AS w
        FROM tmp_hist_bat_inn GROUP BY person_id, venue_id, match_type, gender
        UNION ALL
        SELECT person_id, venue_id, match_type, gender, 0, 0, 0, 0, 0, COUNT(*), SUM(legal_balls), SUM(runs), SUM(wickets)
        FROM tmp_hist_bowl_inn GROUP BY person_id, venue_id, match_type, gender
      ) u
      GROUP BY person_id, venue_id, match_type, gender`,
  },
  {
    table: 'hist_agg_head_to_head',
    insert: `INSERT INTO hist_agg_head_to_head
      (team1_id, team2_id, match_type, gender, matches, team1_wins, team2_wins, ties, draws, no_results, last_match_date)
      SELECT LEAST(team1_id, team2_id) AS a, GREATEST(team1_id, team2_id) AS b, match_type, gender, COUNT(*),
             COALESCE(SUM(outcome = 'WIN' AND winner_id = LEAST(team1_id, team2_id)), 0),
             COALESCE(SUM(outcome = 'WIN' AND winner_id = GREATEST(team1_id, team2_id)), 0),
             SUM(outcome = 'TIE'), SUM(outcome = 'DRAW'), SUM(outcome = 'NO_RESULT'), MAX(start_date)
      FROM hist_matches
      GROUP BY a, b, match_type, gender`,
  },
  {
    table: 'hist_agg_team_phase',
    insert: `INSERT INTO hist_agg_team_phase
      (team_id, match_type, gender, phase, innings, runs, legal_balls, wickets, fours, sixes, dots)
      SELECT i.batting_team_id, m.match_type, m.gender,
             CASE
               WHEN m.match_type IN ('T20', 'IT20') AND d.over_no < 6 THEN 'powerplay'
               WHEN m.match_type IN ('T20', 'IT20') AND d.over_no < 15 THEN 'middle'
               WHEN m.match_type IN ('T20', 'IT20') THEN 'death'
               WHEN d.over_no < 10 THEN 'powerplay'
               WHEN d.over_no < 40 THEN 'middle'
               ELSE 'death'
             END AS phase,
             COUNT(DISTINCT d.match_id, d.innings_no), SUM(d.total_runs), SUM(d.is_legal), SUM(d.team_wickets),
             SUM(d.runs_batter = 4 AND d.non_boundary = 0), SUM(d.runs_batter = 6 AND d.non_boundary = 0),
             SUM(d.is_legal = 1 AND d.total_runs = 0)
      FROM hist_deliveries d
      JOIN hist_innings i ON i.match_id = d.match_id AND i.innings_no = d.innings_no AND i.is_super_over = 0
      JOIN hist_matches m ON m.id = d.match_id
      WHERE m.balls_per_over = 6 AND m.match_type IN ('T20', 'IT20', 'ODI', 'ODM') AND i.batting_team_id IS NOT NULL
      GROUP BY i.batting_team_id, m.match_type, m.gender, phase`,
  },
];

export const AGGREGATE_TABLES = REBUILD.map((r) => r.table);

export async function rebuildAggregates(prisma: PrismaClient): Promise<Record<string, number>> {
  const build = await prisma.histAggBuild.create({ data: { status: 'RUNNING' } });
  try {
    const rowCounts = await prisma.$transaction(
      async (tx) => {
        for (const sql of ['DROP TEMPORARY TABLE IF EXISTS tmp_hist_bat_inn', 'DROP TEMPORARY TABLE IF EXISTS tmp_hist_bowl_inn']) {
          await tx.$executeRawUnsafe(sql);
        }
        for (const sql of [...TEMP_TABLES, ...FILL_TEMP]) await tx.$executeRawUnsafe(sql);
        const counts: Record<string, number> = {};
        for (const { table, insert } of REBUILD) {
          await tx.$executeRawUnsafe(`DELETE FROM ${table}`);
          counts[table] = await tx.$executeRawUnsafe(insert);
        }
        await tx.$executeRawUnsafe('DROP TEMPORARY TABLE IF EXISTS tmp_hist_bat_inn');
        await tx.$executeRawUnsafe('DROP TEMPORARY TABLE IF EXISTS tmp_hist_bowl_inn');
        return counts;
      },
      { timeout: AGG_TX_TIMEOUT_MS, maxWait: 60_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    await prisma.histAggBuild.update({
      where: { id: build.id },
      data: { status: 'COMPLETED', rowCounts, finishedAt: new Date() },
    });
    return rowCounts;
  } catch (error) {
    await prisma.histAggBuild
      .update({ where: { id: build.id }, data: { status: 'FAILED', error: safeErrorMessage(error, 1000), finishedAt: new Date() } })
      .catch(() => undefined);
    throw error;
  }
}
