'use client'

import { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'

interface Metrics {
  total_customers: number
  active_customers: number
  total_orders: number
  total_revenue: string
  avg_order_value: string
  wbuy_customers: number
  legacy_customers: number
}

interface MonthlySale {
  month: string
  orders: number
  revenue: string
}

interface TopCity {
  city: string
  state: string
  total: number
}

function fmt(val: string | number) {
  return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-gray-800 mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

export default function DashboardPage() {
  const [data, setData] = useState<{ metrics: Metrics; monthlySales: MonthlySale[]; topCities: TopCity[] } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-gray-400 text-sm">Carregando...</div>
  if (!data) return <div className="text-red-500 text-sm">Erro ao carregar dados.</div>

  const { metrics, monthlySales, topCities } = data

  const chartData = monthlySales.map((m) => ({
    mes: m.month.slice(5) + '/' + m.month.slice(2, 4),
    Receita: Number(m.revenue),
    Pedidos: m.orders,
  }))

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Visão geral do negócio</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard label="Receita Total" value={fmt(metrics.total_revenue)} />
        <MetricCard label="Total de Clientes" value={metrics.total_customers.toLocaleString('pt-BR')} sub={`${metrics.active_customers} ativos`} />
        <MetricCard label="Total de Pedidos" value={metrics.total_orders.toLocaleString('pt-BR')} />
        <MetricCard label="Ticket Médio" value={fmt(metrics.avg_order_value)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Receita Mensal (últimos 12 meses)</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => fmt(Number(v))} />
              <Bar dataKey="Receita" fill="#16a34a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Canal de Origem</h2>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span>wBuy</span>
                <span>{metrics.wbuy_customers}</span>
              </div>
              <div className="bg-gray-100 rounded-full h-2">
                <div
                  className="bg-green-500 h-2 rounded-full"
                  style={{ width: `${(metrics.wbuy_customers / metrics.total_customers) * 100}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span>Planilha (legado)</span>
                <span>{metrics.legacy_customers}</span>
              </div>
              <div className="bg-gray-100 rounded-full h-2">
                <div
                  className="bg-green-300 h-2 rounded-full"
                  style={{ width: `${(metrics.legacy_customers / metrics.total_customers) * 100}%` }}
                />
              </div>
            </div>
          </div>

          <h2 className="text-sm font-semibold text-gray-700 mt-6 mb-3">Top Cidades</h2>
          <div className="space-y-1.5">
            {topCities.slice(0, 6).map((c) => (
              <div key={`${c.city}-${c.state}`} className="flex justify-between text-xs text-gray-600">
                <span className="truncate">{c.city}{c.state ? ` - ${c.state}` : ''}</span>
                <span className="font-medium ml-2">{c.total}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
