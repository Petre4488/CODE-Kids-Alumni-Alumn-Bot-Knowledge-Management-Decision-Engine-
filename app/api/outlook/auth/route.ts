import { NextResponse } from 'next/server';
import { getOutlookAuthUrl } from '../../../lib/outlook-graph';

export async function GET() {
  if (!process.env.MICROSOFT_CLIENT_ID || !process.env.MICROSOFT_REDIRECT_URI) {
    return NextResponse.json(
      { error: 'Lipsește MICROSOFT_CLIENT_ID sau MICROSOFT_REDIRECT_URI în .env.local' },
      { status: 500 }
    );
  }
  return NextResponse.redirect(getOutlookAuthUrl());
}