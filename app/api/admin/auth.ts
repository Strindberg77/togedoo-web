// app/api/admin/auth.ts
// Delt Bearer-sjekk for admin-endepunktene. Returnerer et feilsvar når
// tilgang mangler, ellers null.
import { NextRequest, NextResponse } from 'next/server';

export function requireAdmin(request: NextRequest): NextResponse | null {
    const secret = process.env.ADMIN_SECRET;
    if (!secret) {
        console.error('[Admin] ADMIN_SECRET er ikke konfigurert');
        return NextResponse.json({ success: false, error: 'Server misconfigured' }, { status: 500 });
    }
    const auth = request.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${secret}`) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    return null;
}
