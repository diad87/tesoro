// Configuración pública de la app web de Firebase (no es un secreto: la seguridad está en firestore.rules).
// Con null, la web funciona sin cuentas: un único borrador guardado en el móvil.
window.FIREBASE_CONFIG = {
  projectId: 'tesoro-ar-app',
  appId: '1:430551227178:web:14985180b2f3ede4bb5c53',
  apiKey: 'AIzaSyDYiZFFHPBji1fZuYLrk7fM25ufidVfbeI',
  // mismo dominio que la web: la ventana de Google muestra este dominio (no *.firebaseapp.com) y el acceso por redirección funciona en Safari
  authDomain: 'tesoro-ar-app.web.app',
  storageBucket: 'tesoro-ar-app.firebasestorage.app',
  messagingSenderId: '430551227178',
};
