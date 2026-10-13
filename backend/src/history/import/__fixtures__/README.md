# Test fixtures

Unmodified match files from [Cricsheet](https://cricsheet.org/) in the classic CSV format,
used only by the parser tests. Cricsheet data is made available under the
[Open Data Commons Attribution License (ODC-By 1.0)](https://opendatacommons.org/licenses/by/1-0/).

| File | Why it is here |
| --- | --- |
| `1000851.csv` | Test match with a declaration (5 dates, 4 innings) |
| `1023647.csv` | Tie decided by super overs (`super_over`, `eliminator`) |
| `1127532.csv` | Penalty runs after an innings (`penalty_runs,1,post,6`) |
| `1252684.csv` | The Hundred: `balls_per_over,5` |
| `1299566.csv` | Non-ASCII text (`’`) |
| `wi_201706.csv` | Non-numeric match id, quoted venue with a comma, empty city |
