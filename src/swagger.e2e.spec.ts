import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { createApiTestApp } from './testing/api-test-app';

describe('Swagger document (e2e)', () => {
  let document: OpenAPIObject;

  beforeAll(async () => {
    const api = await createApiTestApp();
    try {
      document = SwaggerModule.createDocument(api.app, new DocumentBuilder().setTitle('test').build());
    } finally {
      await api.close();
    }
  });

  it.each([
    '/api/v1/matches/live',
    '/api/v1/matches/{id}',
    '/api/v1/matches/{id}/scorecard',
    '/api/v1/matches/{id}/commentary',
    '/api/v1/teams/{id}',
    '/api/v1/players/{id}',
    '/api/v1/leagues/{id}',
    '/api/v1/ads',
    '/api/v1/realtime',
  ])('documents GET %s with success and error responses', (path) => {
    const operation = document.paths[path]?.get;
    expect(operation).toBeDefined();
    expect(operation!.responses['200']).toBeDefined();
    expect(operation!.responses['429']).toBeDefined();
  });

  it('documents every match field and the socket payload schemas', () => {
    const schemas = document.components!.schemas as Record<string, { properties?: Record<string, { description?: string }> }>;
    for (const name of [
      'MatchDto',
      'LiveMatchesDto',
      'ScorecardDto',
      'CommentaryDto',
      'MatchSubscribePayloadDto',
      'SubscribeAckDto',
      'SocketErrorAckDto',
      'MatchSnapshotEventDto',
      'MatchChangeEventDto',
      'ServerErrorEventDto',
      'ErrorResponseDto',
    ]) {
      expect(schemas[name], name).toBeDefined();
    }
    expect(Object.keys(schemas.MatchDto.properties!)).toEqual(
      expect.arrayContaining(['matchId', 'source', 'status', 'isLive', 'score', 'overs', 'batsmen', 'bowler', 'stale']),
    );
    expect(Object.keys(schemas.LiveMatchesDto.properties!)).toEqual(['matches', 'updatedAt', 'stale']);
  });

  it('documents device registration as a public POST', () => {
    const operation = document.paths['/api/v1/devices/register']?.post;
    expect(operation?.responses['200']).toBeDefined();
    expect(operation?.responses['400']).toBeDefined();
    expect(operation?.responses['429']).toBeDefined();
    expect(operation?.security).toBeUndefined();
  });

  it('marks admin metrics as protected and leaves public endpoints open', () => {
    expect(document.paths['/api/v1/realtime/metrics'].get!.security).toEqual([{ 'admin-jwt': [] }]);
    expect(document.paths['/api/v1/matches/live'].get!.security).toBeUndefined();
  });
});
