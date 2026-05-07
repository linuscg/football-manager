import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || supabaseUrl === 'your-project-url') {
  console.warn(
    '[Supabase] No URL configured — add VITE_SUPABASE_URL to .env.local'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
