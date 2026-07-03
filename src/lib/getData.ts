/**
 * 统一数据获取函数
 * - 本地开发（npm run dev）：读 src/data/*.json
 * - 生产构建：直接查 Supabase，精确缓存（无双重校验）
 *   后续相同请求命中精确缓存，不同请求独立查库。
 */

const buildCache = new Map<string, { data: any; error: any }>()

// ═══ getData 主函数 ═══
export async function getData(
  table: string,
  columns: string = '*',
  options: {
    eq?: [string, any]
    neq?: [string, any]
    single?: boolean
    order?: [string, boolean] | [string, boolean][]
    limit?: number
    in?: [string, any[]]
    notNull?: string
  } = {}
) {
  // ── 本地开发模式 ──
  if (import.meta.env.DEV) {
    let data: any[]
    try {
      const fs = await import('fs')
      const path = await import('path')
      const filePath = path.join(process.cwd(), 'src', 'data', `${table}.json`)
      const raw = fs.readFileSync(filePath, 'utf-8')
      data = JSON.parse(raw)
      if (!Array.isArray(data)) data = [data]
    } catch (err: any) {
      throw new Error(`[getData] 读取本地数据文件失败: ${err.message}`)
    }

    if (options.notNull) data = data.filter((r: any) => r[options.notNull!] != null)
    if (options.eq) { const [k, v] = options.eq; data = data.filter((r: any) => r[k] === v) }
    if (options.neq) { const [k, v] = options.neq; data = data.filter((r: any) => r[k] !== v) }
    if (options.in) { const [col, vals] = options.in; data = data.filter((r: any) => vals.includes(r[col])) }
    if (options.order) {
      const orders = Array.isArray(options.order[0]) ? (options.order as [string, boolean][]) : [options.order as [string, boolean]]
      data = [...data].sort((a: any, b: any) => {
        for (const [col, asc = true] of orders) {
          const va = a[col], vb = b[col]
          let cmp: number
          if (typeof va === 'string' && typeof vb === 'string') { cmp = va.localeCompare(vb) }
          else { cmp = (va ?? 0) - (vb ?? 0) }
          if (cmp !== 0) return asc ? cmp : -cmp
        }
        return 0
      })
    }
    if (columns !== '*') {
      const fields = columns.split(',').map((s: string) => s.trim())
      data = data.map((row: any) => { const newRow: any = {}; fields.forEach((f: string) => { newRow[f] = row[f] }); return newRow })
    }
    if (options.limit != null) data = data.slice(0, options.limit)
    if (options.single) return { data: data[0] ?? null, error: null }
    return { data, error: null }
  }

  // ── 生产构建模式 ──
  const isBuild = typeof window === 'undefined' && process.env.NODE_ENV === 'production'
  let cacheKey: string | undefined

  if (isBuild) {
    // 检查精确缓存
    cacheKey = `${table}|${columns}|${JSON.stringify(options)}`
    if (buildCache.has(cacheKey)) {
      console.log(`📦 复用缓存: ${table}`)
      return buildCache.get(cacheKey)!
    }
  }

  // 查询数据库
  const { supabase } = await import('./supabase')
  const maxRetries = 3
  let lastError: any

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      let builder = supabase.from(table).select(columns)
      if (options.notNull) builder = builder.not(options.notNull, 'is', null)
      if (options.eq) builder = builder.eq(options.eq[0], options.eq[1])
      if (options.neq) builder = builder.neq(options.neq[0], options.neq[1])
      if (options.in) builder = builder.in(options.in[0], options.in[1])
      if (options.order) {
        const orders = Array.isArray(options.order[0])
          ? (options.order as [string, boolean][])
          : [options.order as [string, boolean]]
        for (const [col, asc] of orders) {
          builder = builder.order(col, { ascending: asc ?? true })
        }
      }
      if (options.limit != null) builder = builder.limit(options.limit)
      if (options.single) builder = builder.single()

      const result = await builder

      if (!result.error) {
        // 热门快照空数据重试
        if (
          (table === 'gpu_hot_snapshot' || table === 'cpu_hot_snapshot') &&
          (!result.data || result.data.length === 0)
        ) {
          throw new Error(`${table} 返回空数据，需要重试`)
        }

        // 构建时缓存结果（精确缓存）
        if (isBuild && cacheKey) {
          buildCache.set(cacheKey, result)
        }
        return result
      }

      throw result.error
    } catch (err) {
      lastError = err
      if (attempt < maxRetries) {
        console.warn(`[getData] 第${attempt}次查询 ${table} 失败，2秒后重试...`)
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    }
  }

  throw lastError
}
