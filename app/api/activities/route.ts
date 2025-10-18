import { readFileSync } from 'fs';
import { join } from 'path';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const city = searchParams.get('city') || 'oslo';

    try {
        const filePath = join(process.cwd(), 'data', 'activities.json');
        const fileContents = readFileSync(filePath, 'utf8');
        const data = JSON.parse(fileContents);

        if (!data[city]) {
            return NextResponse.json(
                { error: 'City not found' },
                { status: 404 }
            );
        }

        return NextResponse.json(data[city]);
    } catch (error) {
        return NextResponse.json(
            { error: 'Failed to load activities' },
            { status: 500 }
        );
    }
}