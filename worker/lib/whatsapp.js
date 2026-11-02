// Picks the WhatsApp group for a registration (by city/area, class, language).
// The most specific match wins: a specific city beats "all cities", and a
// specific language beats "any language".
export async function findWhatsappLink(env, registration) {
  const cityName = registration.school_id
    ? (await env.DB.prepare('SELECT city FROM schools WHERE id = ?').bind(registration.school_id).first())?.city ?? registration.city
    : registration.city;
  const city = cityName ? await env.DB.prepare('SELECT id FROM cities WHERE name = ?').bind(cityName).first() : null;

  const { results } = await env.DB.prepare(
    `SELECT city_id, classes, language, link FROM whatsapp_groups
     WHERE (city_id IS NULL OR city_id = ?1) AND (language = '' OR language = ?2)`
  ).bind(city?.id ?? '', registration.language).all();

  let best = null;
  let bestScore = -1;
  for (const g of results) {
    let classes = [];
    try { classes = JSON.parse(g.classes); } catch { /* ignore bad row */ }
    if (!classes.includes(registration.class)) continue;
    const score = (g.city_id ? 2 : 0) + (g.language ? 1 : 0);
    if (score > bestScore) { best = g; bestScore = score; }
  }
  return best?.link || null;
}
