import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForTokens } from '../../../lib/outlook-graph';

function popupCloseResponse(status: 'connected' | 'error') {
  const html = `<!DOCTYPE html>
<html>
  <body style="background:#09090b;color:#e4e4e7;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
    <p>${status === 'connected' ? '✓ Outlook conectat! Se închide fereastra...' : '⚠️ Eroare la conectare. Poți închide fereastra.'}</p>
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: 'OUTLOOK_AUTH_DONE', status: '${status}' }, window.location.origin);
      }
      window.close();
    </script>
  </body>
</html>`;
  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  if (!code) {
    return popupCloseResponse('error');
  }

  try {
    await exchangeCodeForTokens(code);
    return popupCloseResponse('connected');
  } catch (err) {
    console.error('Outlook callback error:', err);
    return popupCloseResponse('error');
  }
}