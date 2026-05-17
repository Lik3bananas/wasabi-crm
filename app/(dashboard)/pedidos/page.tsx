'use client'

import { useCallback, useEffect, useState, Suspense } from 'react'
import { useRouter } from 'next/navigation'

interface Item {
  product_name: string
  sku: string | null
  quantity: number
  unit_price: string
  total_price: string
}

interface Purchase {
  id: number
  customer_id: string
  customer_name: string
  purchase_date: string
  total_amount: string
  status: string
  source_channel: string
  item_count: number
  items: Item[]
}

function fmt(val: string | number) {
  return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

const statusColor: Record<string, string> = {
  completed:  'bg-green-100 text-green-700',
  pending:    'bg-yellow-100 text-yellow-700',
  cancelled:  'bg-red-100 text-red-700',
  processing: 'bg-blue-100 text-blue-700',
}
const statusLabel: Record<string, string> = {
  completed:  'Concluído',
  pending:    'Pendente',
  cancelled:  'Cancelado',
  processing: 'Processando',
}

function PedidosContent() {
  const router = useRouter()
  const [purchases, setPurchases]   = useState<Purchase[]>([])
  const [total, setTotal]           = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage]             = useState(1)
  const [search, setSearch]         = useState('')
  const [status, setStatus]         = useState('')
  const [dateFrom, setDateFrom]     = useState('')
  const [dateTo, setDateTo]         = useState('')
  const [loading, setLoading]       = useState(false)
  const [expanded, setExpanded]     = useState<Set<number>>(new Set())

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams()
    if (search)   p.set('search',    search)
    if (status)   p.set('status',    status)
    if (dateFrom) p.set('date_from', dateFrom)
    if (dateTo)   p.set('date_to',   dateTo)
    p.set('page', String(page))
    return p.toString()
  }, [search, status, dateFrom, dateTo, page])

  useEffect(() => {
    setLoading(true)
    setExpanded(new Set()) // collapse all when data changes
    fetch(`/api/purchases?${buildQuery()}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((d) => {
        setPurchases(d.purchases || [])
        setTotal(d.total || 0)
        setTotalPages(d.totalPages || 1)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [buildQuery])

  function toggleRow(id: number) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Pedidos</h1>
        <p className="text-gray-500 text-sm mt-1">{total.toLocaleString('pt-BR')} pedido(s) encontrado(s)</p>
      </div>

      {/* Filters */}
      <form
        onSubmit={(e) => { e.preventDefault(); setPage(1) }}
        className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Nome do cliente"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <select
            value={status} onChange={(e) => setStatus(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
          >
            <option value="">Todos os status</option>
            <option value="completed">Concluído</option>
            <option value="pending">Pendente</option>
            <option value="processing">Processando</option>
            <option value="cancelled">Cancelado</option>
          </select>
          <input
            type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <input
            type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
        <div className="flex justify-end mt-3 gap-2">
          <button
            type="button"
            onClick={() => { setSearch(''); setStatus(''); setDateFrom(''); setDateTo(''); setPage(1) }}
            className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition"
          >
            Limpar
          </button>
          <button
            type="submit"
            className="text-sm bg-green-600 text-white px-4 py-1.5 rounded-lg hover:bg-green-700 transition font-medium"
          >
            Filtrar
          </button>
        </div>
      </form>

      {/* Table */}
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
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-6"></th>
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
                {purchases.map((p) => {
                  const isOpen = expanded.has(p.id)
                  return (
                    <>
                      <tr
                        key={p.id}
                        className={`hover:bg-gray-50 transition cursor-pointer ${isOpen ? 'bg-gray-50' : ''}`}
                        onClick={() => toggleRow(p.id)}
                      >
                        {/* Expand chevron */}
                        <td className="pl-4 pr-0 py-3 text-gray-400 text-xs select-none">
                          {isOpen ? '▲' : '▼'}
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs font-mono">{p.id}</td>
                        <td className="px-4 py-3">
                          {/* Name is a link — stops propagation so row click still works */}
                          <span
                            className="font-medium text-green-700 hover:underline"
                            onClick={(e) => { e.stopPropagation(); router.push(`/clientes/${p.customer_id}`) }}
                          >
                            {p.customer_name}
                          </span>
                        </td>
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
                            p.source_channel === 'wbuy' ? 'bg-blue-100 text-blue-700'
                            : p.source_channel === 'pdvnet' ? 'bg-orange-100 text-orange-700'
                            : p.source_channel === 'legacy' || p.source_channel === 'legacy_spreadsheet' ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-purple-100 text-purple-700'
                          }`}>
                            {p.source_channel === 'wbuy' ? 'wBuy'
                              : p.source_channel === 'pdvnet' ? 'PDVNet'
                              : p.source_channel === 'legacy' || p.source_channel === 'legacy_spreadsheet' ? 'Planilha'
                              : 'Wix'}
                          </span>
                        </td>
                      </tr>

                      {/* Expanded products row */}
                      {isOpen && (
                        <tr key={`${p.id}-items`} className="bg-blue-50/40">
                          <td colSpan={8} className="px-10 py-4">
                            {p.items.length === 0 ? (
                              <p className="text-xs text-gray-400 italic">Sem itens registrados para este pedido.</p>
                            ) : (
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-gray-400 border-b border-gray-200">
                                    <th className="text-left pb-2 font-medium">Produto</th>
                                    <th className="text-left pb-2 font-medium">SKU</th>
                                    <th className="text-right pb-2 font-medium">Qtd</th>
                                    <th className="text-right pb-2 font-medium">Unitário</th>
                                    <th className="text-right pb-2 font-medium">Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {p.items.map((item, i) => (
                                    <tr key={i} className="border-b border-gray-100 last:border-0">
                                      <td className="py-1.5 text-gray-700 pr-4 font-medium">{item.product_name}</td>
                                      <td className="py-1.5 text-gray-400 font-mono pr-4">{item.sku || '—'}</td>
                                      <td className="py-1.5 text-right pr-4">{item.quantity}</td>
                                      <td className="py-1.5 text-right pr-4">{fmt(item.unit_price)}</td>
                                      <td className="py-1.5 text-right font-semibold text-green-700">{fmt(item.total_price)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  {(() => {
                                    const itemsSum = p.items.reduce((s, i) => s + Number(i.total_price), 0)
                                    const paid = Number(p.total_amount)
                                    const discount = itemsSum - paid
                                    return (
                                      <>
                                        {discount > 0.01 && (
                                          <>
                                            <tr>
                                              <td colSpan={4} className="pt-2 text-right text-gray-400">Subtotal</td>
                                              <td className="pt-2 text-right text-gray-500">{fmt(itemsSum)}</td>
                                            </tr>
                                            <tr>
                                              <td colSpan={4} className="text-right text-red-500">Desconto</td>
                                              <td className="text-right text-red-500 font-medium">-{fmt(discount)}</td>
                                            </tr>
                                          </>
                                        )}
                                        <tr className="border-t border-gray-200">
                                          <td colSpan={4} className="pt-2 text-right text-gray-500 font-medium">Total pago</td>
                                          <td className="pt-2 text-right font-bold text-green-700">{fmt(p.total_amount)}</td>
                                        </tr>
                                      </>
                                    )
                                  })()}
                                </tfoot>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-500">
            <span>Página {page} de {totalPages}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition"
              >← Anterior</button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition"
              >Próxima →</button>
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
