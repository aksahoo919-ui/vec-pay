// Cloudflare Worker: serves the website (static files from ./dist) and the /api routes.
import { HttpError, json } from './lib/http.js';
import { login, currentAdmin, requireAdmin, logout } from './lib/auth.js';
import { bootstrap, register, whatsappLink } from './routes/public.js';
import { razorpayWebhook } from './routes/webhook.js';
import * as admin from './routes/admin.js';
import * as sheets from './routes/sheets.js';

const open = (handler) => ({ handler, admin: false });
const adminOnly = (handler) => ({ handler, admin: true });

// [method, path pattern, route]. ":id" matches one path segment.
const ROUTES = [
  ['GET',    '/api/public/bootstrap',              open(bootstrap)],
  ['POST',   '/api/register',                      open(register)],
  ['POST',   '/api/registration/whatsapp',         open(whatsappLink)],
  ['POST',   '/api/razorpay-webhook',              open(razorpayWebhook)],

  ['POST',   '/api/auth/login',                    open(login)],
  ['GET',    '/api/auth/me',                       open(async (req, env) => {
    const username = await currentAdmin(req, env);
    return username ? json({ username }) : json({ error: 'Not signed in' }, 401);
  })],
  ['POST',   '/api/auth/logout',                   open(logout)],

  ['GET',    '/api/admin/bootstrap',               adminOnly(admin.adminBootstrap)],
  ['GET',    '/api/admin/payments',                adminOnly(admin.listPayments)],
  ['PUT',    '/api/admin/payments/:id/book-given', adminOnly(admin.setBookGiven)],
  ['POST',   '/api/admin/cities',                  adminOnly(admin.addCity)],
  ['PUT',    '/api/admin/cities/:id',              adminOnly(admin.renameCity)],
  ['DELETE', '/api/admin/cities/:id',              adminOnly(admin.deleteCity)],
  ['POST',   '/api/admin/schools',                 adminOnly(admin.schools.add)],
  ['PUT',    '/api/admin/schools/:id',             adminOnly(admin.schools.update)],
  ['DELETE', '/api/admin/schools/:id',             adminOnly(admin.schools.remove)],
  ['PUT',    '/api/admin/settings/languages',      adminOnly(admin.setLanguages)],
  ['POST',   '/api/admin/admins',                  adminOnly(admin.addAdmin)],
  ['DELETE', '/api/admin/admins/:id',              adminOnly(admin.removeAdmin)],
  ['POST',   '/api/admin/sheets/create',           adminOnly(sheets.createSheet)],
  ['POST',   '/api/admin/sheets/push',             adminOnly(sheets.pushSheet)],
  ['POST',   '/api/admin/sheets/pull',             adminOnly(sheets.pullSheet)],
  ['POST',   '/api/admin/sheets/make-public',      adminOnly(sheets.makeAllPublic)]
].map(([method, pattern, route]) => ({
  method,
  ...route,
  regex: new RegExp('^' + pattern.replace(/:id/g, '(?<id>[^/]+)') + '$')
}));

async function handleApi(request, env) {
  const { pathname } = new URL(request.url);
  const matches = ROUTES.filter(r => r.regex.test(pathname));
  if (!matches.length) return json({ error: 'Not found' }, 404);

  const route = matches.find(r => r.method === request.method);
  if (!route) return json({ error: 'Method not allowed' }, 405);

  const params = pathname.match(route.regex).groups || {};
  const username = route.admin ? await requireAdmin(request, env) : null;
  return route.handler(request, env, { params, username });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    try {
      return await handleApi(request, env);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error('Unhandled error on', request.method, pathname, err?.stack || err);
      // Admins see the real reason (e.g. a Google error); the public page gets a generic message.
      const message = pathname.startsWith('/api/admin/') && err?.message ? err.message : 'Something went wrong. Please try again.';
      return json({ error: message }, 500);
    }
  }
};
