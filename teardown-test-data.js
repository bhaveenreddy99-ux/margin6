#!/usr/bin/env node
/**
 * RestaurantIQ Test Data Teardown
 * 
 * Removes all test data created by seed-test-data.js
 * Safe to run multiple times (idempotent)
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY environment variable required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const RESTAURANT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

async function teardown() {
  console.log('🧹 Starting teardown of Midwest Franchise Group test data...\n');

  try {
    // Delete restaurant (cascades to everything)
    const { error } = await supabase
      .from('restaurants')
      .delete()
      .eq('id', RESTAURANT_ID);

    if (error) throw error;

    console.log('✅ Test data removed\n');
    console.log('You can now re-run the seed script to start fresh.\n');

  } catch (error) {
    console.error('❌ Teardown failed:', error.message);
    process.exit(1);
  }
}

teardown();
