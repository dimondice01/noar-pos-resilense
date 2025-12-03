import { create } from 'zustand';

export const useCartStore = create((set, get) => ({
  cart: [],
  
  // Agregar producto (Maneja lógica si ya existe o si es nuevo)
  addItem: (product, quantity = 1, finalPrice = null) => {
    const { cart } = get();
    // Si es pesable, siempre es una línea nueva (porque puede variar el peso exacto)
    // Si es unitario (Coca Cola), sumamos cantidad si ya existe.
    
    if (!product.isWeighable) {
      const existingItem = cart.find(item => item.id === product.id);
      if (existingItem) {
        set({
          cart: cart.map(item => 
            item.id === product.id 
              ? { ...item, quantity: item.quantity + 1, subtotal: (item.quantity + 1) * item.price } 
              : item
          )
        });
        return;
      }
    }

    // Nuevo item
    const priceToUse = finalPrice || product.price;
    set({
      cart: [...cart, {
        ...product,
        // Generamos un ID único para el carrito (para diferenciar 2 trozos de jamón distintos)
        cartId: `${product.id}-${Date.now()}`, 
        quantity: quantity, // En pesables, quantity es el peso (0.250)
        subtotal: quantity * priceToUse
      }]
    });
  },

  removeItem: (cartId) => {
    set({ cart: get().cart.filter(item => item.cartId !== cartId) });
  },

  clearCart: () => set({ cart: [] }),

  // Computadas (Getters)
  getTotal: () => {
    return get().cart.reduce((total, item) => total + item.subtotal, 0);
  },
  
  getItemsCount: () => {
    return get().cart.length;
  }
}));
