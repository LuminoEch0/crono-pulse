import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://xlcpextufbgcqhsmawco.supabase.co/rest/v1/'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhsY3BleHR1ZmJnY3Foc21hd2NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzMzEwODMsImV4cCI6MjEwNzkwNzA4M30._zgGCtQZcjbxO0yy_SnE-h-jIr1lIZjIGPJUCErEgLk'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)