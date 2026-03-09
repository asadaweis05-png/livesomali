import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qvjwnpcwerdfupduqxmb.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2anducGN3ZXJkZnVwZHVxeG1iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMTUwNjEsImV4cCI6MjA4ODU5MTA2MX0.fL7Yd7_a8MgGaKiNxx56OSOInn8c2dTR0xOSB7aLdK0';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
