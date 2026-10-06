import type { SingleFlightCache } from '../../cache/single-flight-cache.service';
import { RedisKey } from '../constants/redis-keys';
import { notFound } from './http-errors';

const ENTITY_TTL_SECONDS = 600;
const MISSING_ENTITY_TTL_SECONDS = 30;
const SPORTMONKS_ID = /^[1-9]\d{0,11}$/;

export interface EntityRepository<Row> {
  findById(id: string): Promise<Row | null>;
  findBySportmonksId(sportmonksId: number): Promise<Row | null>;
}

/** Looks a team, player or league up by Latiyal id or backend id, through a short Redis cache. */
export async function lookupEntity<Row, Dto>(
  cache: SingleFlightCache,
  kind: 'team' | 'player' | 'league',
  id: string,
  repository: EntityRepository<Row>,
  map: (row: Row) => Dto,
): Promise<Dto> {
  const { value } = await cache.getOrLoad<Dto | null>(
    RedisKey.entity(kind, id),
    { ttlSeconds: (dto) => (dto ? ENTITY_TTL_SECONDS : MISSING_ENTITY_TTL_SECONDS) },
    async () => {
      const row = SPORTMONKS_ID.test(id)
        ? await repository.findBySportmonksId(Number(id))
        : await repository.findById(id);
      return row ? map(row) : null;
    },
  );
  if (!value) {
    throw notFound(`${kind[0].toUpperCase()}${kind.slice(1)} not found`);
  }
  return value;
}
