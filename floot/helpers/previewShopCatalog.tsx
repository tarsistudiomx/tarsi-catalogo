// Generado desde shop.js. Se comprueba su paridad antes de desplegar.
export const names = [
  "The Amazing Spider-Man",
  "Goku y Shenlong",
  "Gojo Satoru",
  "Rayo McQueen",
  "Sally",
  "Majin Vegeta",
  "Goku Ultra Instinto",
  "Amazing Fantasy",
  "Miles Morales",
  "Spider-Man clásico",
  "Spider-Man emblema",
  "Checo Pérez · Never Give Up",
  "Spider-Man urbano"
];
export const unit = 399;
export const subtotal = (quantity: number) => Math.floor(quantity / 3) * 999 + [0, 399, 699][quantity % 3];
