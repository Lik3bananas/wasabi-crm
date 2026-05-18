'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Metrics {
  total_customers:  number
  active_customers: number
  total_orders:     number
  total_revenue:    string
  avg_order_value:  string
  unique_customers: number
  wbuy_orders:      number
  legacy_orders:    number
}

interface MonthlySale { month: string; orders: number; revenue: string }
interface TopCity      { city: string; state: string; total: number }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(val: string | number) {
  return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function toISO(d: Date) {
  return d.toISOString().slice(0, 10)
}

function fmtBR(iso: string) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

// ─── Period presets ───────────────────────────────────────────────────────────
type Preset = 'today' | 'yesterday' | 'last7' | 'last30' | 'this_month' | 'last_month' | 'custom'

const PRESET_LABELS: Record<Preset, string> = {
  today:      'Hoje',
  yesterday:  'Ontem',
  last7:      'Últimos 7 dias',
  last30:     'Últimos 30 dias',
  this_month: 'Este mês',
  last_month: 'Mês passado',
  custom:     'Personalizado',
}

function getPresetRange(p: Preset): { from: string; to: string } {
  const now   = new Date()
  const today = toISO(now)
  switch (p) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday': {
      const d = new Date(now); d.setDate(d.getDate() - 1); const s = toISO(d)
      return { from: s, to: s }
    }
    case 'last7': {
      const d = new Date(now); d.setDate(d.getDate() - 6)
      return { from: toISO(d), to: today }
    }
    case 'last30': {
      const d = new Date(now); d.setDate(d.getDate() - 29)
      return { from: toISO(d), to: today }
    }
    case 'this_month': {
      const d = new Date(now.getFullYear(), now.getMonth(), 1)
      return { from: toISO(d), to: today }
    }
    case 'last_month': {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const to   = new Date(now.getFullYear(), now.getMonth(), 0)
      return { from: toISO(from), to: toISO(to) }
    }
    default:
      return { from: '', to: '' }
  }
}

// ─── MetricCard ───────────────────────────────────────────────────────────────
function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-gray-800 mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [data, setData]         = useState<{ metrics: Metrics; monthlySales: MonthlySale[]; topCities: TopCity[] } | null>(null)
  const [loading, setLoading]   = useState(true)
  const [preset, setPreset]     = useState<Preset>('this_month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo,   setCustomTo]   = useState('')

  const fetchData = useCallback((from: string, to: string) => {
    setLoading(true)
    const qs = new URLSearchParams()
    if (from) qs.set('date_from', from)
    if (to)   qs.set('date_to',   to)
    fetch(`/api/dashboard?${qs}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  // Default: este mês
  useEffect(() => {
    const { from, to } = getPresetRange('this_month')
    fetchData(from, to)
  }, [fetchData])

  function selectPreset(p: Preset) {
    setPreset(p)
    if (p === 'custom') return          // wait for user to fill dates
    const { from, to } = getPresetRange(p)
    fetchData(from, to)
  }

  function applyCustom() {
    if (!customFrom || !customTo) return
    fetchData(customFrom, customTo)
  }

  function periodDescription() {
    if (preset === 'custom') {
      if (customFrom && customTo) return `${fmtBR(customFrom)} – ${fmtBR(customTo)}`
      return 'Período personalizado'
    }
    return PRESET_LABELS[preset]
  }

  const chartData = (data?.monthlySales ?? []).map((m) => ({
    mes:     m.month.slice(5) + '/' + m.month.slice(2, 4),
    Receita: Number(m.revenue),
    Pedidos: m.orders,
  }))

  const PRESETS: Preset[] = ['today', 'yesterday', 'last7', 'last30', 'this_month', 'last_month', 'custom']

  return (
    <div>
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Visão geral do negócio</p>
      </div>

      {/* ── Period filter ──────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Período de análise</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => selectPreset(p)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                preset === p
                  ? 'bg-green-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
        </div>

        {/* Custom date range */}
        {preset === 'custom' && (
          <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">De</label>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Até</label>
              <input
                type="date"
                value={customTo}
                min={customFrom}
                onChange={(e) => setCustomTo(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <button
              onClick={applyCustom}
              disabled={!customFrom || !customTo}
              className="px-4 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg disabled:opacity-40 hover:bg-green-700 transition-colors"
            >
              Buscar
            </button>
          </div>
        )}
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="text-gray-400 text-sm py-12 text-center">Carregando...</div>
      ) : !data ? (
        <div className="text-red-500 text-sm py-12 text-center">Erro ao carregar dados.</div>
      ) : (
        <>
          {/* Metric cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <MetricCard
              label="Receita no Período"
              value={fmt(data.metrics.total_revenue)}
            />
            <MetricCard
              label="Clientes Únicos"
              value={data.metrics.unique_customers.toLocaleString('pt-BR')}
              sub={`de ${data.metrics.total_customers.toLocaleString('pt-BR')} na base`}
            />
            <MetricCard
              label="Pedidos no Período"
              value={data.metrics.total_orders.toLocaleString('pt-BR')}
            />
            <MetricCard
              label="Ticket Médio"
              value={fmt(data.metrics.avg_order_value)}
            />
          </div>

          {/* Chart + sidebar */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            {/* Revenue chart */}
            <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-1">
                Receita por Período
              </h2>
              <p className="text-xs text-gray-400 mb-4">{periodDescription()}</p>
              {chartData.length === 0 ? (
                <div className="flex items-center justify-center h-[220px] text-gray-400 text-sm">
                  Nenhum dado para o período selecionado
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v) => fmt(Number(v))} />
                    <Bar dataKey="Receita" fill="#16a34a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Sidebar */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Canal de Origem</h2>
              <div className="space-y-3">
                {[
                  { label: 'wBuy',             count: data.metrics.wbuy_orders,   color: 'bg-green-500' },
                  { label: 'Planilha (legado)', count: data.metrics.legacy_orders, color: 'bg-green-300' },
                ].map(({ label, count, color }) => (
                  <div key={label}>
                    <div className="flex justify-between text-xs text-gray-600 mb-1">
                      <span>{label}</span>
                      <span>{count.toLocaleString('pt-BR')}</span>
                    </div>
                    <div className="bg-gray-100 rounded-full h-2">
                      <div
                        className={`${color} h-2 rounded-full transition-all`}
                        style={{
                          width: data.metrics.total_orders > 0
                            ? `${Math.min(100, (count / data.metrics.total_orders) * 100)}%`
                            : '0%',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <h2 className="text-sm font-semibold text-gray-700 mt-6 mb-3">Top Cidades</h2>
              <div className="space-y-1.5">
                {data.topCities.slice(0, 6).map((c) => (
                  <div key={`${c.city}-${c.state}`} className="flex justify-between text-xs text-gray-600">
                    <span className="truncate">{c.city}{c.state ? ` — ${c.state}` : ''}</span>
                    <span className="font-medium ml-2">{c.total}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
