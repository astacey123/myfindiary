// POST /api/stripe-webhook
//
// Stripe calls this automatically whenever a payment event happens — we only
// care about "checkout.session.completed" (the £5 signup payment succeeding).
// When that fires, we mark the matching Supabase user as paid so they can get
// into the dashboard. This never runs in the browser, so it's the one place
// it's safe to use the Supabase *service role* key (which bypasses RLS).
//
// After deploying, register this endpoint's URL in the Stripe dashboard:
//   Developers → Webhooks → Add endpoint → https://yourdomain.com/api/stripe-webhook
//   Event to send: checkout.session.completed
// Stripe will then give you a signing secret — put it in STRIPE_WEBHOOK_SECRET.
//
// Requires these environment variables:
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET       — from the Stripe webhook you register (see above)
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   — SECRET, server-only

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

// Stripe needs the exact raw request bytes to verify the webhook signature,
// so we turn off Vercel's automatic JSON body parsing for this route only.
module.exports.config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('stripe-webhook: missing required environment variables');
    res.status(500).send('Server misconfigured');
    return;
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('stripe-webhook: signature verification failed:', err.message);
    res.status(400).send(`Webhook signature verification failed: ${err.message}`);
    return;
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.client_reference_id || session.metadata?.supabase_user_id;

      if (userId) {
        const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        const { error } = await supabaseAdmin
          .from('profiles')
          .update({
            has_paid: true,
            stripe_customer_id: typeof session.customer === 'string' ? session.customer : null,
            stripe_checkout_session_id: session.id,
          })
          .eq('id', userId);

        if (error) {
          console.error('stripe-webhook: failed to mark profile as paid:', error);
          // Still return 200 below — Stripe will retry on non-2xx, but this is a
          // logging/DB issue on our end, not something retrying will usually fix.
        }
      } else {
        console.error('stripe-webhook: checkout.session.completed had no client_reference_id/metadata to match a user');
      }
    }
    // Other event types (e.g. payment_failed) are ignored for now — only the
    // signup event above changes anything. Add more `else if` blocks here later
    // if you want to react to refunds, disputes, etc.

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('stripe-webhook: handler error:', err);
    res.status(500).send('Webhook handler error');
  }
};
