'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Cart {
  cart_id: string
  date: string
  total: number
  wbuy_status: string
  customer_name: string
  customer_email: string | null
  customer_phone: string | null
  customer_city: string | null
  customer_state: string | null
  products: Product[]
  existing_customer: ExistingCustomer | null
  _profileCreated?: boolean
  _createdCustomerId?: string
}

interface Product {
  name: string
  sku: string | null
  qty: number
  price: number
  color: string | null
  variation: string | null
}

interface ExistingCustomer {
  id: string
  full_name: string
  email: string
  phone: string
  total_spent: string
  purchase_count: number
  last_purchase_date: string
  source_channel: string
}

function fmt(v: string | number) {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(d: string | Date) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

function fmtDateTime(d: string | Date) {
  if (!d) return '—'
  return new Date(d).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// Bookmarklet script — extracts carts from wBuy panel and POSTs to our API
const BOOKMARKLET_CODE = `javascript:(function(){
var items=document.querySelectorAll('div.item.dblclick');
if(!items.length){alert('Nenhum carrinho encontrado. Acesse: painel > Pedidos > Carrinhos abandonados');return;}
var carts=[];
items.forEach(function(item){
  var excEl=item.querySelector('[onclick*="exclui_email"]');
  var idM=excEl?excEl.getAttribute('onclick').match(/'id':'([^']+)'/):null;
  var cartId=idM?idM[1]:null;
  if(!cartId)return;
  var text=item.innerText;
  var emailM=text.match(/[\\w.\\-+]+@[\\w.\\-]+\\.\\w+/);
  var valM=text.match(/R\\$[\\d.,]+/);
  var dateM=text.match(/\\d{2}\\/\\d{2}\\/\\d{4}/);
  var timeM=text.match(/\\d{2}h\\d{2}/);
  var lines=item.innerText.split('\\n').map(function(l){return l.trim();}).filter(Boolean);
  var name='';
  for(var i=0;i<lines.length;i++){
    if(lines[i]&&!lines[i].match(/^\\d/)&&!lines[i].includes('@')&&!lines[i].includes('R$')&&!lines[i].toLowerCase().includes('produto')&&!lines[i].toLowerCase().includes('recupera')&&!lines[i].toLowerCase().includes('envio')&&lines[i].length>3){
      name=lines[i];break;
    }
  }
  var status=text.includes('Recuperado')?'Recuperado':(text.includes('Em recupera')?'Em recuperação':'Abandonado');
  carts.push({cartId:cartId,name:name,email:emailM?emailM[0]:null,total:valM?valM[0]:'R$0,00',productCount:(text.match(/(\\d+)\\s*produto/)||[])[1]||'0',date:dateM?dateM[0]:null,time:timeM?timeM[0]:null,status:status});
});
if(!carts.length){alert('Não foi possível extrair os dados.');return;}
fetch('${typeof window !== 'undefined' ? window.location.origin : ''}/api/abandoned-carts/sync',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({carts:carts,synced_at:new Date().toISOString()})
}).then(function(r){return r.json();}).then(function(d){
  alert('✅ Sync concluído!\\n'+d.inserted+' novos, '+d.updated+' atualizados.\\nTotal: '+d.total+' carrinhos.');
}).catch(function(e){alert('❌ Erro: '+e.message);});
})();`

export default function CarrinhoPage() {
  const router = useRouter()
  const [carts, setCarts]       = useState<Cart[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState<Set<string>>(new Set())
  const [showBookmarklet, setShowBookmarklet] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/abandoned-carts')
      if (!res.ok) throw new Error('Falha ao buscar carrinhos')
      const data = await res.json()
      setCarts(data.carts || [])
      setLastSync(data.last_sync || null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function toggleExpanded(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function createProfile(cart: Cart) {
    setCreating(prev => new Set(prev).add(cart.cart_id))
    try {
      const res = await fetch('/api/abandoned-carts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name:  cart.customer_name,
          customer_email: cart.customer_email,
          customer_phone: cart.customer_phone,
          cart_id:        cart.cart_id,
          date:           cart.date,
          total:          cart.total,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro')

      setCarts(prev =>
        prev.map(c =>
          c.cart_id === cart.cart_id
            ? { ...c, _profileCreated: true, _createdCustomerId: data.customer_id }
            : c
        )
      )
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Erro ao criar perfil')
    } finally {
      setCreating(prev => {
        const next = new Set(prev)
        next.delete(cart.cart_id)
        return next
      })
    }
  }

  const [search, setSearch] = useState('')

  const filteredCarts = search.trim()
    ? carts.filter(c => {
        const q = search.trim().toLowerCase()
        return (
          c.customer_name?.toLowerCase().includes(q) ||
          c.customer_email?.toLowerCase().includes(q) ||
          c.customer_phone?.replace(/\D/g, '').includes(q.replace(/\D/g, '')) ||
          c.customer_phone?.toLowerCase().includes(q)
        )
      })
    : carts

  const totalValue    = filteredCarts.reduce((s, c) => s + c.total, 0)
  const newCustomers  = filteredCarts.filter(c => !c.existing_customer).length
  const existingCount = filteredCarts.filter(c =>  c.existing_customer).length

  // Build the bookmarklet href with actual origin
  const bookmarkletHref = BOOKMARKLET_CODE.replace(
    '${typeof window !== \'undefined\' ? window.location.origin : \'\'}',
    typeof window !== 'undefined' ? window.location.origin : ''
  )

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Carrinhos Abandonados</h1>
          <p className="text-gray-500 text-sm mt-1">
            Últimos 7 dias — sincronizado do painel wBuy
            {lastSync && (
              <span className="ml-2 text-xs text-gray-400">
                · última sync: {fmtDateTime(lastSync)}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBookmarklet(v => !v)}
            className="flex items-center gap-2 text-sm bg-blue-50 border border-blue-200 hover:border-blue-400 text-blue-700 px-4 py-2 rounded-lg transition"
          >
            🔖 Sync wBuy
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 text-sm bg-white border border-gray-200 hover:border-green-400 text-gray-600 hover:text-green-700 px-4 py-2 rounded-lg transition disabled:opacity-50"
          >
            <span className={loading ? 'animate-spin' : ''}>↻</span>
            Atualizar
          </button>
        </div>
      </div>

      {/* Bookmarklet instructions */}
      {showBookmarklet && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-5">
          <h3 className="font-semibold text-blue-900 mb-2">Como sincronizar com o painel wBuy</h3>
          <ol className="text-sm text-blue-800 space-y-2 mb-4">
            <li><strong>1.</strong> Arraste o botão abaixo para a barra de favoritos do seu navegador:</li>
          </ol>
          <a
            href={bookmarkletHref}
            onClick={e => e.preventDefault()}
            draggable
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg cursor-grab active:cursor-grabbing select-none"
          >
            🛒 Sync Carrinhos → CRM
          </a>
          <ol className="text-sm text-blue-800 space-y-2 mt-4" start={2}>
            <li><strong>2.</strong> Abra o painel wBuy → <strong>Pedidos → Carrinhos abandonados</strong></li>
            <li><strong>3.</strong> Clique no favorito <em>"Sync Carrinhos → CRM"</em> na barra de favoritos</li>
            <li><strong>4.</strong> Uma mensagem confirmará quantos carrinhos foram sincronizados</li>
            <li><strong>5.</strong> Volte aqui e clique em <strong>Atualizar</strong></li>
          </ol>
          <p className="text-xs text-blue-600 mt-3">
            💡 Dica: configure o filtro de data no painel wBuy antes de clicar no favorito para controlar quais carrinhos são sincronizados.
          </p>
        </div>
      )}

      {/* Search */}
      {!loading && !error && carts.length > 0 && (
        <div className="mb-5">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nome, e-mail ou telefone..."
              className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-green-400 focus:ring-1 focus:ring-green-300 bg-white"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none"
              >
                ×
              </button>
            )}
          </div>
          {search && (
            <p className="text-xs text-gray-400 mt-1.5 pl-1">
              {filteredCarts.length} resultado{filteredCarts.length !== 1 ? 's' : ''} para &quot;{search}&quot;
            </p>
          )}
        </div>
      )}

      {/* Stats */}
      {!loading && !error && filteredCarts.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-400 mb-1">Total de carrinhos</p>
            <p className="text-xl font-bold text-gray-800">{carts.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-400 mb-1">Valor em risco</p>
            <p className="text-xl font-bold text-green-700">{fmt(totalValue)}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-400 mb-1">Clientes existentes</p>
            <p className="text-xl font-bold text-blue-700">{existingCount}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-400 mb-1">Clientes novos</p>
            <p className="text-xl font-bold text-orange-600">{newCustomers}</p>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-sm">Carregando carrinhos...</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-red-700 font-medium">{error}</p>
          <button onClick={load} className="mt-3 text-sm text-red-600 underline">Tentar novamente</button>
        </div>
      )}

      {/* Empty — no sync yet */}
      {!loading && !error && carts.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-10 text-center">
          <p className="text-3xl mb-3">🔄</p>
          <p className="font-semibold text-amber-800 text-lg">Nenhum carrinho nos últimos 7 dias</p>
          <p className="text-amber-600 text-sm mt-1">
            Clique em <strong>Sync wBuy</strong> para importar os carrinhos do painel wBuy.
          </p>
        </div>
      )}

      {/* Empty search result */}
      {!loading && !error && carts.length > 0 && filteredCarts.length === 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-10 text-center">
          <p className="text-3xl mb-3">🔍</p>
          <p className="font-semibold text-gray-700">Nenhum resultado encontrado</p>
          <p className="text-gray-400 text-sm mt-1">Tente buscar por outro nome, e-mail ou telefone.</p>
        </div>
      )}

      {/* Cart list */}
      {!loading && !error && filteredCarts.length > 0 && (
        <div className="space-y-4">
          {filteredCarts.map((cart) => {
            const isOpen     = expanded.has(cart.cart_id)
            const isCreating = creating.has(cart.cart_id)
            const profileDone = cart._profileCreated

            return (
              <div
                key={cart.cart_id}
                className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden"
              >
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    {/* Left */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-semibold text-gray-800 text-base">{cart.customer_name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          cart.wbuy_status === 'Recuperado'
                            ? 'bg-green-100 text-green-700'
                            : cart.wbuy_status === 'Em recuperação'
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-red-100 text-red-700'
                        }`}>
                          {cart.wbuy_status}
                        </span>
                      </div>

                      <div className="text-sm text-gray-500 space-y-0.5">
                        {cart.customer_email && <p>✉ {cart.customer_email}</p>}
                        {cart.customer_phone && <p>📱 {cart.customer_phone}</p>}
                        {cart.customer_city && (
                          <p>📍 {cart.customer_city}{cart.customer_state ? ` - ${cart.customer_state}` : ''}</p>
                        )}
                        <p className="text-xs text-gray-400">
                          ID: {cart.cart_id} · {fmtDate(cart.date)}
                        </p>
                      </div>
                    </div>

                    {/* Right */}
                    <div className="text-right flex-shrink-0">
                      <p className="text-lg font-bold text-green-700">{fmt(cart.total)}</p>

                      {cart.existing_customer ? (
                        <div className="space-y-1 mt-1">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                            Cliente existente
                          </span>
                          <div className="text-xs text-gray-400 mt-1">
                            <p>{fmt(cart.existing_customer.total_spent)} em compras</p>
                            <p>{cart.existing_customer.purchase_count} pedido(s)</p>
                          </div>
                          <button
                            onClick={() => router.push(`/clientes/${cart.existing_customer!.id}`)}
                            className="mt-2 text-xs text-blue-600 hover:underline font-medium block"
                          >
                            Ver perfil completo →
                          </button>
                        </div>
                      ) : profileDone ? (
                        <div className="space-y-1 mt-1">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                            Perfil criado ✓
                          </span>
                          <button
                            onClick={() => router.push(`/clientes/${cart._createdCustomerId}`)}
                            className="mt-2 text-xs text-green-600 hover:underline font-medium block"
                          >
                            Ver perfil →
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-1 mt-1">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">
                            Cliente novo
                          </span>
                          <button
                            onClick={() => createProfile(cart)}
                            disabled={isCreating}
                            className="mt-2 text-xs bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg font-medium transition disabled:opacity-50 block w-full"
                          >
                            {isCreating ? 'Criando...' : 'Criar Perfil'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Toggle products */}
                  {cart.products.length > 0 && (
                    <button
                      onClick={() => toggleExpanded(cart.cart_id)}
                      className="mt-3 text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 transition"
                    >
                      {isOpen ? '▲ Ocultar produtos' : '▼ Ver produtos'}
                    </button>
                  )}
                </div>

                {/* Products table */}
                {isOpen && cart.products.length > 0 && (
                  <div className="border-t border-gray-100 bg-gray-50 px-5 py-4">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-400 border-b border-gray-200">
                          <th className="text-left pb-2">Produto</th>
                          <th className="text-left pb-2">SKU</th>
                          <th className="text-left pb-2">Variação</th>
                          <th className="text-right pb-2">Qtd</th>
                          <th className="text-right pb-2">Unitário</th>
                          <th className="text-right pb-2">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cart.products.map((p, i) => (
                          <tr key={i} className="border-b border-gray-100 last:border-0">
                            <td className="py-1.5 text-gray-700 pr-3 font-medium">{p.name}</td>
                            <td className="py-1.5 text-gray-400 font-mono pr-3">{p.sku || '—'}</td>
                            <td className="py-1.5 text-gray-500 pr-3">
                              {[p.color, p.variation].filter(Boolean).join(' / ') || '—'}
                            </td>
                            <td className="py-1.5 text-right pr-3">{p.qty}</td>
                            <td className="py-1.5 text-right pr-3">{fmt(p.price)}</td>
                            <td className="py-1.5 text-right font-semibold text-green-700">{fmt(p.qty * p.price)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
