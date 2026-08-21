// POST /api/create-checkout-session
//
// Called by the frontend right after someone signs up. It verifies the
// person's Supabase login token (so nobody can fake being a different user),
// then asks Stripe to create a one-time £5 Checkout Session and hands back
// the URL to redirect the browser to. Card details are entered on Stripe's
// own hosted page — they never touch our server or database.
//
// Requires these environment variables to be set in your hosting provider
// (Vercel/Netlify project settings → Environment Variables):
//   STRIPE_SECRET_KEY          — from the Stripe dashboard (Developers → API keys)
//   SUPABASE_URL                — from Supabase (Project Settings → API)
//   SUPABASE_SERVICE_ROLE_KEY   — from Supabase (Project Settings → API) — SECRET, server-only

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const SIGNUP_PRICE_PENCE = 500; // £5.00

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const authHeader = req.headers.authorization || '';
    const accessToken = authHeader.replace(/^Bearer\s+/i, '');
    if (!accessToken) {
      res.status(401).json({ error: 'Missing access token' });
      return;
    }

    if (!process.env.STRIPE_SECRET_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      res.status(500).json({ error: 'Server is missing required environment variables. See SETUP.md.' });
      return;
    }

    // Verify the token server-side rather than trusting anything the client sends —
    // this is what stops someone from paying and marking a *different* account as paid.
    const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: userResult, error: userError } = await supabaseAdmin.auth.getUser(accessToken);
    if (userError || !userResult?.user) {
      res.status(401).json({ error: 'Invalid or expired session — please sign in again.' });
      return;
    }
    const user = userResult.user;

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const origin = req.headers.origin || `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: user.email,
      client_reference_id: user.id,
      metadata: { supabase_user_id: user.id },
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            unit_amount: SIGNUP_PRICE_PENCE,
            product_data: { name: 'Financial Diary — one-time signup' },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancelled`,
    });

    // Remember which checkout session we sent this user to, so support/debugging is easier.
    await supabaseAdmin.from('profiles').update({ stripe_checkout_session_id: session.id }).eq('id', user.id);

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session error:', err);
    res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
};
