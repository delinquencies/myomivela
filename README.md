# myomivela

## Picking up the project

Start with [the handoff](docs/handoff.md) for the current state and next steps. The [audit notes](docs/audits/) capture findings from each review.

The public website and care portal run together on Node 24. Use `npm start` from the repository root and open `http://127.0.0.1:45838/`. GitHub Pages can serve the public HTML but cannot run the care portal API. The preview directory at `myo/index.html` links to the original sample screens.

Set `MYO_ADMIN_EMAIL` and `MYO_ADMIN_PASSWORD` before the first server start to create Myomi's staff account. Use a unique password of at least 12 characters. The variables create the account once. Restarting does not overwrite the password. Sign in as staff to set prices and publish appointment windows. Customers register separately and can request an available window for their own pets.

`MYO_DB` selects the SQLite database path (default `.myo/data.sqlite`). For an HTTPS deployment configure the exact `MYO_ORIGIN`, set `MYO_SECURE_COOKIES=1`, and keep the database on a private persistent volume. The app defaults to loopback and is not a public deployment by itself. Use separate databases for previews and real customer data.

The sample screens use a prebuilt Tailwind stylesheet. After editing their utility classes or the Tailwind configuration, regenerate it and commit the result:

```sh
npm ci
npm run build
```

The care portal supports booking requests, visit tracking, and private diary updates. Payments and email delivery are pending. Keep real customer data out of the old sample screens.
