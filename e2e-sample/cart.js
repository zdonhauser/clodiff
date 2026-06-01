// Sample module for clodiff end-to-end review testing.
export function subtotal(items) {
  let total = 0
  for (const it of items) {
    total += it.price * it.qty
  }
  return total
}

export function applyCoupon(total, coupon) {
  return total - coupon.amount
}

export function withTax(total, rate) {
  const tax = total * rate
  return total + tax
}

export function formatPrice(n) {
  return "$" + n.toFixed(2)
}
