# Data Templates

Use these example files as starting points for manual imports.

- Copy `investor.example.csv` to `investor.csv` and replace the sample row with real investor snapshot data.
- Copy `screening.example.csv` to `screening.csv` and replace the sample row with real screening output.
- The screening importer also accepts `daily_action_sheet_YYYY-MM-DD.csv` files or a whole directory that contains them.

Import commands:

```cmd
npm run import:investor -- --file .\data\investor.csv --dry-run
npm run import:investor -- --file .\data\investor.csv

npm run import:screening -- --file .\data\screening.csv --dry-run
npm run import:screening -- --file .\data\screening.csv
npm run import:screening -- --file D:\Codex\Screening\output --dry-run
npm run import:screening -- --file D:\Codex\Screening\output
```
