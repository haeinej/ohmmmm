import type { APIRoute } from 'astro';
import { source } from '../../service';

export const prerender = false;
export const GET: APIRoute = async ({ cookies, params }) => {
  const viewerToken = cookies.get('ohm_viewer')?.value;
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!viewerToken || !params.name) return new Response(null, { status: 404, headers });
  try {
    return await source.readMedia({ name: params.name, viewerToken });
  } catch (error) {
    const status = error instanceof Error && 'status' in error && error.status === 404 ? 404 : 502;
    return new Response(null, { status, headers });
  }
};
