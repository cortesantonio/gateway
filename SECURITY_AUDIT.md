# Auditoría de Seguridad - Backend DIRCOM ERP

## Fecha: $(date)
## Estado: ✅ Vulnerabilidades Críticas Corregidas

---

## 🔴 VULNERABILIDADES CRÍTICAS ENCONTRADAS Y CORREGIDAS

### 1. **CRÍTICO: Credenciales Hardcodeadas en el Código**
**Ubicación:** `gateway/src/files/files.service.ts` (líneas 24-28)

**Problema:**
- Credenciales de MinIO (endpoint, puerto, accessKey, secretKey) estaban hardcodeadas en el código fuente
- Riesgo: Exposición de credenciales en repositorios, logs, y builds

**Solución:**
- ✅ Movidas todas las credenciales a variables de entorno
- ✅ Agregada validación para asegurar que las variables estén presentes

**Variables de entorno requeridas:**
```
MINIO_ENDPOINT=117.9.74.145
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=appuser
MINIO_SECRET_KEY=070202Acs
```

---

### 2. **CRÍTICO: CORS Abierto a Todos los Orígenes**
**Ubicación:** `gateway/src/main.ts` (línea 7)

**Problema:**
- `origin: '*'` permite que cualquier sitio web haga requests al backend
- Riesgo: Ataques CSRF, acceso no autorizado desde cualquier dominio

**Solución:**
- ✅ Configurado CORS para aceptar solo orígenes específicos
- ✅ Configuración mediante variable de entorno `ALLOWED_ORIGINS`
- ✅ Fallback seguro para desarrollo local

**Variable de entorno:**
```
ALLOWED_ORIGINS=https://tu-dominio.com,https://www.tu-dominio.com
```

---

### 3. **ALTO: Endpoints Sin Autenticación**
**Ubicación:** `gateway/src/files/files.controller.ts`

**Problema:**
- Endpoint `POST /files/upload` sin protección de autenticación
- Endpoint `GET /files/:filename/info` sin protección de autenticación
- Riesgo: Cualquiera puede subir archivos o obtener información de archivos

**Solución:**
- ✅ Agregado `@UseGuards(SupabaseAuthGuard)` a ambos endpoints
- ✅ Ahora requieren token de autenticación válido

---

### 4. **MEDIO: Falta de Headers de Seguridad HTTP**
**Ubicación:** `gateway/src/main.ts`

**Problema:**
- No se configuran headers de seguridad HTTP (X-Frame-Options, CSP, etc.)
- Riesgo: Vulnerable a clickjacking, XSS, y otros ataques

**Solución:**
- ✅ Integrado Helmet.js para configurar headers de seguridad automáticamente
- ✅ Configurado Content Security Policy (CSP)
- ✅ Headers de protección contra clickjacking, XSS, etc.

---

### 5. **MEDIO: Falta de Rate Limiting**
**Ubicación:** `gateway/src/app.module.ts`

**Problema:**
- No hay límite de requests por IP/usuario
- Riesgo: Ataques de fuerza bruta, DDoS, abuso de recursos

**Solución:**
- ✅ Integrado `@nestjs/throttler` para rate limiting
- ✅ Configurado: 100 requests por minuto por IP
- ✅ Aplicado globalmente a todos los endpoints

---

### 6. **MEDIO: Posible Header Injection en Content-Disposition**
**Ubicación:** `gateway/src/files/files.controller.ts` (línea 86)

**Problema:**
- El nombre del archivo se inserta directamente en el header sin sanitización
- Riesgo: Header injection attack, posible ejecución de código

**Solución:**
- ✅ Sanitización del nombre del archivo (eliminación de caracteres peligrosos)
- ✅ Limitación de longitud del nombre
- ✅ Encoding UTF-8 apropiado

---

## 📋 VARIABLES DE ENTORNO REQUERIDAS

Crea un archivo `.env` en la raíz del proyecto `gateway/` con las siguientes variables:

```env
# Puerto del servidor
PORT=3000

# Supabase
SUPABASE_URL=tu_supabase_url
SUPABASE_ANON_KEY=tu_supabase_anon_key

# MinIO
MINIO_ENDPOINT=117.9.74.145
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=appuser
MINIO_SECRET_KEY=070202Acs

# CORS - Orígenes permitidos (separados por comas)
ALLOWED_ORIGINS=https://tu-dominio-produccion.com,https://www.tu-dominio-produccion.com
```

**⚠️ IMPORTANTE:** 
- NUNCA subas el archivo `.env` al repositorio
- Usa diferentes credenciales para producción
- Rota las credenciales regularmente

---

## 📦 DEPENDENCIAS AGREGADAS

Las siguientes dependencias fueron agregadas para mejorar la seguridad:

```json
{
  "@nestjs/throttler": "^6.0.0",
  "helmet": "^8.0.0",
  "minio": "^8.0.0"
}
```

**Instalación:**
```bash
cd gateway
npm install
```

---

## ✅ RECOMENDACIONES ADICIONALES PARA PRODUCCIÓN

### 1. **Validación de Archivos Mejorada**
- Considera agregar validación de contenido real del archivo (magic bytes)
- Implementa escaneo de virus/malware para archivos subidos
- Limita tipos MIME más estrictamente

### 2. **Logging y Monitoreo**
- Implementa logging estructurado (Winston, Pino)
- Configura alertas para intentos de acceso no autorizados
- Monitorea rate limiting y bloquea IPs sospechosas

### 3. **HTTPS Obligatorio**
- Asegúrate de que MinIO use SSL en producción (`MINIO_USE_SSL=true`)
- Configura certificados SSL válidos
- Habilita HSTS (HTTP Strict Transport Security)

### 4. **Validación de Entrada**
- Considera usar class-validator para DTOs
- Valida todos los parámetros de entrada
- Sanitiza todos los datos de usuario

### 5. **Secrets Management**
- Usa un servicio de gestión de secretos (AWS Secrets Manager, HashiCorp Vault)
- No almacenes secretos en variables de entorno en producción
- Rota credenciales regularmente

### 6. **Backup y Recuperación**
- Implementa backups regulares de MinIO
- Documenta procedimientos de recuperación ante desastres
- Prueba restauraciones periódicamente

---

## 🔍 CHECKLIST PRE-PRODUCCIÓN

- [x] Credenciales movidas a variables de entorno
- [x] CORS configurado correctamente
- [x] Autenticación en todos los endpoints sensibles
- [x] Headers de seguridad HTTP configurados
- [x] Rate limiting implementado
- [x] Headers sanitizados para prevenir injection
- [ ] Variables de entorno configuradas en servidor de producción
- [ ] SSL/TLS configurado para MinIO
- [ ] Logging y monitoreo configurados
- [ ] Backups configurados
- [ ] Pruebas de seguridad realizadas
- [ ] Documentación actualizada


