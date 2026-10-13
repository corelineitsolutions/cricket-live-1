import { nameParts, normalizeText, proposePlayers, proposeTeams, proposeVenues, splitTeamGender, venueParts } from './identity-matching';

describe('identity matching', () => {
  it('splits names into initials and surname, keeping particles', () => {
    expect(nameParts('RG Sharma')).toEqual({ full: 'rg sharma', surname: 'sharma', initials: 'rg' });
    expect(nameParts('Rohit Sharma')).toMatchObject({ surname: 'sharma', initials: 'r' });
    expect(nameParts('AB de Villiers')).toMatchObject({ surname: 'de villiers', initials: 'ab' });
    expect(nameParts('Quinton de Kock')).toMatchObject({ surname: 'de kock', initials: 'q' });
    expect(nameParts('Mahendra Singh Dhoni')).toMatchObject({ surname: 'dhoni', initials: 'ms' });
    expect(nameParts('Rashid')).toMatchObject({ surname: 'rashid', initials: '' });
    expect(nameParts('Shai Hope')).toMatchObject({ surname: 'hope', initials: 's' });
    expect(normalizeText("  Trinbago Knight-Riders & Co. ")).toBe('trinbago knight riders and co');
  });

  it('proposes exact and initials matches, using the national team to break ties', () => {
    const people = [
      { personId: 'aaaaaaaa', names: ['RG Sharma'] },
      { personId: 'bbbbbbbb', names: ['R Sharma'] },
      { personId: 'cccccccc', names: ['V Kohli'] },
      { personId: 'dddddddd', names: ['Mohammad Rizwan'] },
    ];
    const international = new Map([
      ['aaaaaaaa', new Set(['india'])],
      ['bbbbbbbb', new Set(['nepal'])],
      ['cccccccc', new Set(['india'])],
      ['dddddddd', new Set(['pakistan'])],
    ]);
    const { proposals, unmatched } = proposePlayers(
      [
        { latiyalId: 1, name: 'Rohit Sharma', country: 'India' },
        { latiyalId: 2, name: 'Virat Kohli', country: null },
        { latiyalId: 3, name: 'Mohammad Rizwan', country: 'Pakistan' },
        { latiyalId: 4, name: 'Joe Root', country: 'England' },
      ],
      people,
      international,
    );
    expect(unmatched).toBe(1);
    expect(proposals).toEqual([
      expect.objectContaining({ latiyal: 1, hist: 'aaaaaaaa', method: 'initials_surname', confidence: 70 }),
      expect.objectContaining({ latiyal: 2, hist: 'cccccccc', method: 'initials_surname', confidence: 60 }),
      expect.objectContaining({ latiyal: 3, hist: 'dddddddd', method: 'exact_name', confidence: 100 }),
    ]);
  });

  it('lowers confidence for ties and skips players with too many candidates', () => {
    const people = ['a', 'b', 'c', 'd'].map((c) => ({ personId: c.repeat(8), names: [`${c.toUpperCase()} Khan`] }));
    people.push({ personId: '11111111', names: ['R Singh'] }, { personId: '22222222', names: ['RP Singh'] });
    people.push(...['3', '4', '5', '6'].map((c) => ({ personId: c.repeat(8), names: ['S Ahmed'] })));
    const result = proposePlayers(
      [
        { latiyalId: 1, name: 'Rahul Singh', country: null },
        { latiyalId: 2, name: 'Sami Ahmed', country: null },
      ],
      people,
      new Map(),
    );
    expect(result.proposals.map((p) => [p.latiyal, p.hist, p.confidence])).toEqual([
      [1, '11111111', 40],
      [1, '22222222', 40],
    ]);
    expect(result.ambiguous).toBe(1);
  });

  it('matches teams by name and reads the gender from Latiyal names', () => {
    expect(splitTeamGender('India Women')).toEqual({ base: 'India', gender: 'female' });
    expect(splitTeamGender('Australia W')).toEqual({ base: 'Australia', gender: 'female' });
    expect(splitTeamGender('West Indies')).toEqual({ base: 'West Indies', gender: 'male' });
    const { proposals, unmatched } = proposeTeams(
      [
        { latiyalId: 10, name: 'India' },
        { latiyalId: 11, name: 'India Women' },
        { latiyalId: 12, name: 'Atlantis' },
      ],
      [{ id: 1, name: 'India', teamType: 'international' }],
    );
    expect(unmatched).toBe(1);
    expect(proposals.map((p) => [p.latiyal, p.hist, p.gender, p.confidence])).toEqual([
      [10, 1, 'male', 90],
      [11, 1, 'female', 90],
    ]);
  });

  it('matches every spelling of a venue in the same city and never across cities', () => {
    expect(venueParts({ name: 'Wankhede Stadium, Mumbai', city: 'Mumbai' })).toEqual({ name: 'wankhede stadium', city: 'mumbai' });
    expect(venueParts({ name: 'Wankhede Stadium, Mumbai', city: null })).toEqual({ name: 'wankhede stadium', city: 'mumbai' });
    const { proposals, unmatched } = proposeVenues(
      [
        { name: 'Wankhede Stadium', city: 'Mumbai' },
        { name: 'Gymkhana Ground', city: 'Nairobi' },
      ],
      [
        { id: 1, name: 'Wankhede Stadium', city: 'Mumbai' },
        { id: 2, name: 'Wankhede Stadium, Mumbai', city: 'Mumbai' },
        { id: 3, name: 'Wankhede Stadium', city: null },
        { id: 4, name: 'Gymkhana Ground', city: 'Mumbai' },
      ],
    );
    expect(unmatched).toBe(1);
    expect(proposals.map((p) => [p.hist, p.confidence])).toEqual([
      [1, 90],
      [2, 90],
      [3, 75],
    ]);
  });
});
