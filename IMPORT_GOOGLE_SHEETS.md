# Import a list from Google Sheets

1. **Prepare the sheet**  
   Put headers in the **first row**. You must have a column named **Items** (or **Item**). Optional columns: **archived**, **comments** or **comment**, **category**.  
   In **archived**, use `x`, `yes`, `true`, or `1` to mark a row as archived; leave blank for active. Row order in the sheet becomes list order.

2. **Share it**  
   In Google Sheets: **Share** → **General access** → **Anyone with the link** → **Viewer** (or use **Publish to web**). The app downloads the sheet as CSV from Google’s servers; without view access the import will fail.

3. **Import in the app**  
   Sign in, open the **menu** (☰, top left next to your profile), choose **Import from Google Sheet**, paste the full browser URL of the sheet, optionally set a **List name**, then **Import**.

4. **Deep link (optional)**  
   You can open the import screen with the URL prefilled:  
   `https://myfamilist.com/import?sheet=` plus your sheet URL wrapped in `encodeURIComponent(...)`.  
   Example (JavaScript):  
   `'/import?sheet=' + encodeURIComponent('https://docs.google.com/spreadsheets/d/YOUR_ID/edit')`

5. **List title**  
   The server tries to read the spreadsheet name from the public Google Docs page (`og:title` / page title) after a successful CSV download, so you often get the real title without any API key. If that fails, it uses the **Google Sheets API** when `GOOGLE_SHEETS_API_KEY` is set. If both fail, the list is named **Import**, **Import 2**, etc., unless you use **List name (optional)**.

6. **Deploy note**  
   The bulk import uses the Supabase RPC `import_list_items`. Apply the SQL from `import_list_items_rpc.sql` (or the matching block in `sql queries.txt`) to your project before using import in production.
