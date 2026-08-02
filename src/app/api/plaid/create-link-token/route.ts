import { NextResponse } from 'next/server';
import { plaidClient, isPlaidEnabled } from '@/lib/plaidClient';
import { Products, CountryCode } from 'plaid';

export async function POST(request: Request) {
  try {
    if (!isPlaidEnabled()) {
      // Return mock link token for UI testing when Plaid is not configured
      return NextResponse.json({
        link_token: 'mock_link_token_' + Math.random().toString(36).substr(2, 9),
        isMock: true,
      });
    }

    let products = [Products.Transactions];
    try {
      const body = await request.json();
      if (body.isInvestment) {
        products = [Products.Investments];
      }
    } catch {
      // No body passed or failed parsing, default to Transactions
    }

    const configs = {
      user: {
        client_user_id: 'user_local',
      },
      client_name: 'Dinero Wealth Tracker',
      products: products,
      country_codes: [CountryCode.Us],
      language: 'en',
    };

    const createTokenResponse = await plaidClient!.linkTokenCreate(configs);
    return NextResponse.json(createTokenResponse.data);
  } catch (error: any) {
    console.error('Error creating Plaid Link Token:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create link token' },
      { status: 500 }
    );
  }
}
