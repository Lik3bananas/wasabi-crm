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
  wbuy_orders:         number
  wix_orders:          number
  pdv_orders:          number
  avg_items_per_order: string
  total_units:         number
}

interface MonthlySale { month: string; orders: number; revenue: string }
interface TopState     { state: string; total: number }

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
  const [data, setData]       = useState<{ metrics: Metrics; monthlySales: MonthlySale[]; topCities: TopState[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')
  // Track the applied range to show in the chart subtitle
  const [appliedFrom, setAppliedFrom] = useState('')
  const [appliedTo,   setAppliedTo]   = useState('')

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
    const now  = new Date()
    const from = toISO(new Date(now.getFullYear(), now.getMonth(), 1))
    const to   = toISO(now)
    setDateFrom(from)
    setDateTo(to)
    setAppliedFrom(from)
    setAppliedTo(to)
    fetchData(from, to)
  }, [fetchData])

  function applyFilter() {
    setAppliedFrom(dateFrom)
    setAppliedTo(dateTo)
    fetchData(dateFrom, dateTo)
  }

  function clearFilter() {
    setDateFrom('')
    setDateTo('')
    setAppliedFrom('')
    setAppliedTo('')
    fetchData('', '')
  }

  const chartSubtitle = appliedFrom && appliedTo
    ? `${fmtBR(appliedFrom)} – ${fmtBR(appliedTo)}`
    : 'Todo o período'

  const chartData = (data?.monthlySales ?? []).map((m) => ({
    mes:     m.month.slice(5) + '/' + m.month.slice(2, 4),
    Receita: Number(m.revenue),
    Pedidos: m.orders,
  }))

  return (
    <div>
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Visão geral do negócio</p>
      </div>

      {/* ── Period filter ──────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-5 py-4 mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Data inicial</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Data final</label>
            <input
              type="date"
              value={dateTo}
              min={dateFrom}
              onChange={(e) => setDateTo(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <button
            onClick={applyFilter}
            disabled={!dateFrom || !dateTo}
            className="px-5 py-2 bg-green-600 text-white text-sm font-medium rounded-lg disabled:opacity-40 hover:bg-green-700 transition-colors"
          >
            Aplicar
          </button>
          {(appliedFrom || appliedTo) && (
            <button
              onClick={clearFilter}
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              Limpar
            </button>
          )}
        </div>
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
              label="Clientes"
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

          {/* Items-per-order row */}
          <div className="grid grid-cols-2 lg:grid-cols-2 gap-4 mb-8">
            <MetricCard
              label="Peças por Venda"
              value={Number(data.metrics.avg_items_per_order).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
              sub="média de itens por pedido"
            />
            <MetricCard
              label="Total de Peças Vendidas"
              value={data.metrics.total_units.toLocaleString('pt-BR')}
              sub="unidades no período"
            />
          </div>

          {/* Chart + sidebar */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            {/* Revenue chart */}
            <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-1">Receita por Período</h2>
              <p className="text-xs text-gray-400 mb-4">{chartSubtitle}</p>
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
                  { label: 'PDV',   count: data.metrics.pdv_orders,  color: 'bg-green-600' },
                  { label: 'wBuy',  count: data.metrics.wbuy_orders,  color: 'bg-green-400' },
                  { label: 'Wix',   count: data.metrics.wix_orders,   color: 'bg-green-200' },
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

              <h2 className="text-sm font-semibold text-gray-700 mt-6 mb-3">Top Estados</h2>
              <div className="space-y-1.5">
                {data.topCities.slice(0, 8).map((c) => (
                  <div key={c.state} className="flex justify-between text-xs text-gray-600">
                    <span>{c.state || '—'}</span>
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
