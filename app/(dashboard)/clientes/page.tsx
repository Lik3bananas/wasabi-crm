'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

interface Customer {
  id: number
  full_name: string
  email: string
  phone: string
  city: string
  state: string
  total_spent: string
  purchase_count: number
  last_purchase_date: string
  source_channel: string
  is_active: boolean
}

function fmt(val: string | number) {
  return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('pt-BR')
}

function ClientesContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [search, setSearch] = useState(searchParams.get('search') || '')
  const [city, setCity] = useState(searchParams.get('city') || '')
  const [state, setState] = useState(searchParams.get('state') || '')
  const [filter, setFilter] = useState(searchParams.get('filter') || '')
  const [dateFrom, setDateFrom] = useState(searchParams.get('date_from') || '')
  const [dateTo, setDateTo] = useState(searchParams.get('date_to') || '')
  const [page, setPage] = useState(Number(searchParams.get('page') || 1))

  const [customers, setCustomers] = useState<Customer[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams()
    if (search) p.set('search', search)
    if (city) p.set('city', city)
    if (state) p.set('state', state)
    if (filter) p.set('filter', filter)
    if (dateFrom) p.set('date_from', dateFrom)
    if (dateTo) p.set('date_to', dateTo)
    p.set('page', String(page))
    return p.toString()
  }, [search, city, state, filter, dateFrom, dateTo, page])

  useEffect(() => {
    setLoading(true)
    fetch(`/api/customers?${buildQuery()}`)
      .then((r) => r.json())
      .then((d) => {
        setCustomers(d.customers || [])
        setTotal(d.total || 0)
        setTotalPages(d.totalPages || 1)
      })
      .finally(() => setLoading(false))
  }, [buildQuery])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setPage(1)
  }

  function handleReset() {
    setSearch(''); setCity(''); setState(''); setFilter(''); setDateFrom(''); setDateTo(''); setPage(1)
  }

  async function handleExport() {
    setExporting(true)
    const qs = buildQuery()
    const res = await fetch(`/api/export?${qs}`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `clientes-${new Date().toISOString().slice(0, 10)}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
    setExporting(false)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Clientes</h1>
          <p className="text-gray-500 text-sm mt-1">{total.toLocaleString('pt-BR')} cliente(s) encontrado(s)</p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || customers.length === 0}
          className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
        >
          📥 {exporting ? 'Exportando...' : 'Exportar Excel'}
        </button>
      </div>

      <form onSubmit={handleSearch} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nome, e-mail ou telefone"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Cidade"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <input
            value={state}
            onChange={(e) => setState(e.target.value)}
            placeholder="Estado (ex: SP)"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
          >
            <option value="">Todos os clientes</option>
            <option value="best_buyers">Melhores compradores</option>
            <option value="inactive_30">Inativos há +30 dias</option>
            <option value="inactive_60">Inativos há +60 dias</option>
            <option value="inactive_90">Inativos há +90 dias</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>Compras entre</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            <span>e</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <div className="flex gap-2 ml-auto">
            <button type="button" onClick={handleReset}
              className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition">
              Limpar
            </button>
            <button type="submit"
              className="text-sm bg-green-600 text-white px-4 py-1.5 rounded-lg hover:bg-green-700 transition font-medium">
              Buscar
            </button>
          </div>
        </div>
      </form>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-gray-400 text-sm">Buscando clientes...</div>
        ) : customers.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm">Nenhum cliente encontrado.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Nome</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Contato</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Cidade</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Total Gasto</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Pedidos</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Última Compra</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Canal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {customers.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50 transition cursor-pointer"
                    onClick={() => router.push(`/clientes/${c.id}`)}>
                    <td className="px-4 py-3">
                      <span className="font-medium text-green-700 hover:underline">{c.full_name}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      <div>{c.email || '—'}</div>
                      <div className="text-xs">{c.phone || ''}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{c.city ? `${c.city}${c.state ? ` - ${c.state}` : ''}` : '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-800">{fmt(c.total_spent)}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{c.purchase_count}</td>
                    <td className="px-4 py-3 text-gray-500">{fmtDate(c.last_purchase_date)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        c.source_channel === 'wbuy' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {c.source_channel === 'wbuy' ? 'wBuy' : 'Wix'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-500">
            <span>Página {page} de {totalPages}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition">
                ← Anterior
              </button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition">
                Próxima →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ClientesPage() {
  return (
    <Suspense>
      <ClientesContent />
    </Suspense>
  )
}
