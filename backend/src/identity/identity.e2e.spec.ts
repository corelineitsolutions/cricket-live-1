import request from 'supertest';
import { adminAuthHeader, seedAdmin } from '../testing/admin-auth';
import { ApiTestApp, createApiTestApp } from '../testing/api-test-app';
import { FakeDb, matchRow, playerRow, teamRow } from '../testing/fake-db';

describe('Admin identity mapping (e2e)', () => {
  let api: ApiTestApp;
  let db: FakeDb;
  let auth: string;

  beforeEach(async () => {
    db = new FakeDb();
    await seedAdmin(db);
    db.rows.player.push(playerRow(501, 'Rohit Sharma'), playerRow(502, 'Virat Kohli'), playerRow(503, 'Rahul Sharma'));
    db.rows.team.push(teamRow(101, 'India', 'IND'), teamRow(102, 'India Women', 'INDW'));
    db.rows.match.push(matchRow(9001, { venueName: 'Wankhede Stadium', venueCity: 'Mumbai' }));
    db.rows.histPerson.push({ id: 'aaaaaaaa', name: 'RG Sharma' }, { id: 'cccccccc', name: 'V Kohli' });
    db.rows.histPersonName.push({ personId: 'aaaaaaaa', name: 'RG Sharma' }, { personId: 'cccccccc', name: 'V Kohli' });
    db.rows.histTeam.push({ id: 1, name: 'India', teamType: 'international' });
    db.rows.histVenue.push({ id: 7, name: 'Wankhede Stadium, Mumbai', city: 'Mumbai' });
    db.rawRows = [
      { personId: 'aaaaaaaa', name: 'India' },
      { personId: 'cccccccc', name: 'India' },
    ];
    api = await createApiTestApp({ db });
    auth = await adminAuthHeader(api);
  });

  afterEach(async () => {
    await api.close();
  });

  const get = (path: string) => request(api.http).get(`/api/v1/admin/identity${path}`).set('Authorization', auth);
  const post = (path: string, body: object = {}) => request(api.http).post(`/api/v1/admin/identity${path}`).set('Authorization', auth).send(body);
  const patch = (path: string, body: object) => request(api.http).patch(`/api/v1/admin/identity${path}`).set('Authorization', auth).send(body);

  it('requires an admin', async () => {
    await request(api.http).get('/api/v1/admin/identity/summary').expect(401);
    await request(api.http).post('/api/v1/admin/identity/players/propose').expect(401);
  });

  it('proposes without confirming, is idempotent and never touches reviewed rows', async () => {
    const first = await post('/players/propose').expect(200);
    // Rahul Sharma (India) also fits "RG Sharma"; only a review can tell them apart.
    expect(first.body.data).toMatchObject({ kind: 'players', created: 3 });
    expect(db.rows.identityPlayerMap.every((r) => r.status === 'PROPOSED')).toBe(true);

    const rohit = db.rows.identityPlayerMap.find((r) => r.latiyalPlayerId === 501)!;
    await patch(`/players/${rohit.id}`, { status: 'REJECTED' }).expect(200);

    const second = await post('/players/propose').expect(200);
    expect(second.body.data).toMatchObject({ created: 0, updated: 0 });
    expect(db.rows.identityPlayerMap.find((r) => r.id === rohit.id)!.status).toBe('REJECTED');

    expect((await post('/teams/propose').expect(200)).body.data.created).toBe(2);
    expect((await post('/venues/propose').expect(200)).body.data.created).toBe(1);

    const summary = await get('/summary').expect(200);
    expect(summary.body.data.mappings.players).toEqual({ PROPOSED: 2, CONFIRMED: 0, REJECTED: 1 });
    expect(summary.body.data.mappings.teams.PROPOSED).toBe(2);
  });

  it('lists proposals with names from both sides and filters by status and name', async () => {
    await post('/players/propose').expect(200);
    const list = await get('/players?status=PROPOSED').expect(200);
    expect(list.body.meta.total).toBe(3);
    const rohit = list.body.data.find((r: { latiyal: { id: number } }) => r.latiyal.id === 501);
    expect(rohit).toMatchObject({ latiyal: { name: 'Rohit Sharma' }, hist: { id: 'aaaaaaaa', name: 'RG Sharma' }, method: 'initials_surname' });

    const kohli = await get('/players?q=Kohli').expect(200);
    expect(kohli.body.data.map((r: { latiyal: { id: number } }) => r.latiyal.id)).toEqual([502]);
  });

  it('confirms one-to-one for players and refuses a second confirmation', async () => {
    await post('/players/propose').expect(200);
    const [rohit, rahul] = [501, 503].map((id) => db.rows.identityPlayerMap.find((r) => r.latiyalPlayerId === id)!);
    const confirmed = await patch(`/players/${rohit.id}`, { status: 'CONFIRMED' }).expect(200);
    expect(confirmed.body.data).toMatchObject({ status: 'CONFIRMED', latiyal: { id: 501 } });
    expect(db.rows.identityPlayerMap.find((r) => r.id === rohit.id)).toMatchObject({ reviewedBy: expect.any(String), reviewedAt: expect.any(Date) });

    const clash = await patch(`/players/${rahul.id}`, { status: 'CONFIRMED' }).expect(409);
    expect(clash.body.code).toBe('CONFLICT');
  });

  it('creates manual mappings after checking both sides exist', async () => {
    await post('/players', { latiyalPlayerId: 999, histPersonId: 'aaaaaaaa' }).expect(404);
    await post('/players', { latiyalPlayerId: 502, histPersonId: 'zzzzzzzz' }).expect(400);
    const made = await post('/players', { latiyalPlayerId: 502, histPersonId: 'cccccccc' }).expect(200);
    expect(made.body.data).toMatchObject({ status: 'CONFIRMED', method: 'manual', confidence: 100 });

    await post('/teams', { latiyalTeamId: 101, histTeamId: 1, gender: 'male' }).expect(200);
    await post('/teams', { latiyalTeamId: 102, histTeamId: 1, gender: 'male' }).expect(409);
    await post('/teams', { latiyalTeamId: 102, histTeamId: 1, gender: 'female' }).expect(200);

    await post('/venues', { liveVenueName: 'Wankhede Stadium', liveVenueCity: 'Mumbai', histVenueId: 7 }).expect(200);
    await post('/venues', { liveVenueName: 'Brabourne Stadium', liveVenueCity: 'Mumbai', histVenueId: 7 }).expect(409);
  });

  it('searches the Cricsheet side by name and validates input', async () => {
    const people = await get('/players/history-search?q=Sharma').expect(200);
    expect(people.body.data).toEqual([{ id: 'aaaaaaaa', name: 'RG Sharma', detail: null }]);
    await get('/players/history-search?q=a').expect(400);
    await get('/umpires').expect(400);
    await patch('/players/whatever', { status: 'MAYBE' }).expect(400);
    await patch('/players/missing-id', { status: 'CONFIRMED' }).expect(404);
  });
});
