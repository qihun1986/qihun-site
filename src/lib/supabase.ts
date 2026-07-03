import { createClient } from '@supabase/supabase-js'

// 直接写死 Supabase 配置（anon key 是公开的，安全）
const supabaseUrl = 'https://azvcjobnbgreffuuceyi.supabase.co'
const supabaseAnonKey = 'sb_publishable_hV8gIo_nFvqyYHhKqsi6Rw_S9AfwazX'

// ★ 惰性初始化：只在真正被调用时才创建客户端
let _supabase: ReturnType<typeof createClient> | null = null

export const supabase = new Proxy({} as ReturnType<typeof createClient>, {
  get(_, prop) {
    if (!_supabase) {
      _supabase = createClient(supabaseUrl, supabaseAnonKey)
    }
    return (_supabase as any)[prop]
  }
})
