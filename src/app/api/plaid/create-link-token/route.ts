import { NextResponse } from 'next/server';
import { getPlaidClient, isPlaidEnabled } from '@/lib/plaidClient';
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

    const configs: any = {
      user: {
        client_user_id: 'user_local',
      },
      client_name: 'Dinero Wealth Tracker',
      products: products,
      country_codes: [CountryCode.Us],
      language: 'en',
    };

    const plaidClient = getPlaidClient();
    const createTokenResponse = await plaidClient!.linkTokenCreate(configs);
    return NextResponse.json(createTokenResponse.data);
  } catch (error: any) {
    console.error('Error creating Plaid Link Token:', error?.response?.data || error.message || error);
    return NextResponse.json(
      { error: error?.response?.data?.error_message || error.message || 'Failed to create link token', details: error?.response?.data },
      { status: error?.response?.status || 500 }
    );
  }
}
