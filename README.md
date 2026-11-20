# Grab it

Grab it is served by the included Node.js server. Keep the original `Grab it.html` name; the server serves it at `/` and also recognizes `Grab_it.html` and `index.html`.

## Local setup

1. Install Node.js 18 or newer.
2. Create a Supabase project.
3. In the Supabase SQL Editor, run `supabase/migrations/202611200001_initial_schema.sql`.
4. Copy `.env.example` to `.env` and fill in the Supabase project URL, anon/publishable key, and server-only service role key.
5. For payments, create Razorpay **Test Mode** API keys and enter them in `.env`. The key ID must start with `rzp_test_`; live keys are rejected by the payment endpoints.
6. Run `node server.mjs`, or use `Start Grab it.bat` on Windows. Open `http://localhost:3000`.

Supabase Auth email confirmation may be enabled by default. Configure the Auth email confirmation and site URL settings in Supabase for the local or deployed URL. Users need to confirm their email if signup returns the confirmation message.

## Render deployment

Create a **Web Service** connected to the project repository (not a Static Site):

- Runtime: Node
- Build command: leave empty
- Start command: `node server.mjs`
- Add the variables from `.env.example` in Render's Environment settings.
- Set `NODE_ENV=production`. Render supplies `PORT`; the server listens on `0.0.0.0`.
- Add the Render service URL to Supabase Auth's allowed redirect/site URL settings.

Never commit `.env`, the Supabase service role key, or a Razorpay secret. The service role key is server-only and bypasses RLS, so it must only exist in the Node service's environment.

## Accounts, data, and administrator access

Signup/login use Supabase Auth. The browser holds an HttpOnly session cookie; authenticated carts and order history are stored in Supabase. COD and UPI-on-delivery orders are written by the server. Prices are checked against the database product rows when orders are placed; cart values and totals sent by the browser are not trusted. Razorpay orders are stored as pending and marked paid only after the server verifies the signature and checks the captured payment with Razorpay.

RLS is enabled for profiles, products, carts, orders, and order items. Users can access their own profile, cart, and orders. Admin operations go through server routes that check the signed-in user's `profiles.role` using a server-only service key. To grant administrator access, first sign in once, then run this statement in the SQL Editor after replacing the email:

```sql
update public.profiles p
set role = 'admin'
from auth.users u
where p.user_id = u.id and u.email = 'admin@example.com';
```

The account drawer's Admin dashboard provides order status updates and product name/price/stock edits. Product IDs are the catalog indices used by the current storefront; deleting products is intentionally not exposed in the dashboard.

## Environment variables

See `.env.example`. The existing archive included a `.env` with a populated Razorpay key ID and secret. Rotate that Razorpay key pair before using the integration, especially if the ZIP was shared or committed anywhere. The extracted secret-bearing `.env` is not included in this working project. No live payment key is needed or accepted.

## Known project constraints

- The original storefront layout and illustrations remain. Product names, prices, and stock synchronize from the database; newly added products use the existing catalog card style and a default icon/category.
- Stock is checked at checkout. The current schema does not decrement stock or reserve inventory, so an operator must update stock after fulfillment.
- No third-party keys are included in this source package. Supabase and Razorpay setup is required before account, database, or payment flows can run.
