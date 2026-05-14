'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Suspense } from 'react'

interface Purchase {
  id: number
  customer_id: number
  customer_name: string
  purchase_date: string
  total_amount: string
  status: string
  source_channel: string
  item_count: number
}

function fmt(val: string | number) {
  return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('pt-BR')
}

const statusColor: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  cancelled: 'bg-red-100 text-red-700',
  processing: 'bg-blue-100 text-blue-700',
}
const statusLabel: Record<string, string> = {
  completed: 'Concluído',
  pending: 'Pendente',
  cancelled: 'Cancelado',
  processing: 'Processando',
}

function PedidosContent() {
  const router = useRouter()
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [loading, setLoading] = useState(false)

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams()
    if (search) p.set('search', search)
    if (status) p.set('status', status)
    if (dateFrom) p.set('date_from', dateFrom)
    if (dateTo) p.set('date_to', dateTo)
    p.set('page', String(page))
    return p.toString()
  }, [search, status, dateFrom, dateTo, page])

  useEffect(() => {
    setLoading(true)
    fetch(`/api/purchases?${buildQuery()}`)
      .then((r) => r.json())
      .then((d) => {
        setPurchases(d.purchases || [])
        setTotal(d.total || 0)
        setTotalPages(d.totalPages || 1)
      })
      .finally(() => setLoading(false))
  }, [buildQuery])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Pedidos</h1>
        <p className="text-gray-500 text-sm mt-1">{total.toLocaleString('pt-BR')} pedido(s) encontrado(s)</p>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); setPage(1) }}
        className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Nome do cliente"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white">
            <option value="">Todos os status</option>
            <option value="completed">Concluído</option>
            <option value="pending">Pendente</option>
            <option value="processing">Processando</option>
            <option value="cancelled">Cancelado</option>
          </select>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
        <div className="flex justify-end mt-3 gap-2">
          <button type="button" onClick={() => { setSearch(''); setStatus(''); setDateFrom(''); setDateTo(''); setPage(1) }}
            className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition">
            Limpar
          </button>
          <button type="submit"
            className="text-sm bg-green-600 text-white px-4 py-1.5 rounded-lg hover:bg-green-700 transition font-medium">
            Filtrar
          </button>
        </div>
      </form>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-gray-400 text-sm">Carregando pedidos...</div>
        ) : purchases.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm">Nenhum pedido encontrado.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">#</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Cliente</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Data</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Valor</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Itens</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Canal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {purchases.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50 transition cursor-pointer"
                    onClick={() => router.push(`/clientes/${p.customer_id}`)}>
                    <td className="px-4 py-3 text-gray-400 text-xs">{p.id}</td>
                    <td className="px-4 py-3 font-medium text-green-700">{p.customer_name}</td>
                    <td className="px-4 py-3 text-gray-600">{fmtDate(p.purchase_date)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[p.status] || 'bg-gray-100 text-gray-600'}`}>
                        {statusLabel[p.status] || p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-800">{fmt(p.total_amount)}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{p.item_count}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        p.source_channel === 'wbuy' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {p.source_channel === 'wbuy' ? 'wBuy' : 'Wix'}
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
                className="px-3 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition">← Anterior</button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition">Próxima →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function PedidosPage() {
  return <Suspense><PedidosContent /></Suspense>
}
