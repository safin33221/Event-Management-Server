# External Services & Credential Guide (Portfolio Showcase Media)

This document covers the external media service required to run the **Portfolio Showcase Event & Direct Upload** workflow in Softilo Event Management. Only **Cloudinary** is required for this feature; no third-party video player service or additional cloud storage account is needed.

---

## 1. Environment Variables Summary

| Service | Environment variable | Purpose | Required/Optional | Frontend/Backend | Where to obtain |
| --- | --- | --- | --- | --- | --- |
| Cloudinary | `CLOUDINARY_CLOUD_NAME` | Identifies your Cloudinary product environment (cloud) for upload endpoints and CDN delivery URLs (`res.cloudinary.com/<cloud_name>/...`) | **Required** | Backend (returned to Frontend inside signed upload payload) | Cloudinary Console → **Dashboard** or **Settings → Product Environments** |
| Cloudinary | `CLOUDINARY_API_KEY` | Public identifier paired with the signature to authenticate browser-to-Cloudinary signed upload requests | **Required** | Backend (returned to Frontend inside signed upload payload) | Cloudinary Console → **Settings → Access Keys** |
| Cloudinary | `CLOUDINARY_API_SECRET` | Private HMAC/SHA-1 signing secret used **only** on the NestJS server to sign upload parameters and verify responses | **Required** | **Backend only** (never exposed to browser or frontend bundle) | Cloudinary Console → **Settings → Access Keys** |
| Cloudinary | `CLOUDINARY_UPLOAD_PRESET` | Optional signed upload preset name if your Cloudinary account enforces preset-level incoming transformations or moderation | Optional | Backend (included in signed parameters when configured) | Cloudinary Console → **Settings → Upload → Upload Presets** |
| Cloudinary | `CLOUDINARY_FOLDER_PREFIX` | Base folder prefix in Cloudinary under which each showcase event's assets are stored (`<prefix>/<eventId>/...`) | Optional (default: `softilo/portfolio`) | Backend | Chosen per studio deployment |
| Application Config | `PORTFOLIO_ALLOWED_IMAGE_FORMATS` | Comma-separated list of allowed image extensions for showcase uploads | Optional (default: `jpg,jpeg,png,webp,avif,heic`) | Backend | Local / production `.env` |
| Application Config | `PORTFOLIO_ALLOWED_VIDEO_FORMATS` | Comma-separated list of allowed highlight video extensions | Optional (default: `mp4,webm,mov`) | Backend | Local / production `.env` |
| Application Config | `PORTFOLIO_MAX_IMAGE_BYTES` | Maximum file size in bytes for a single photo upload | Optional (default: `15728640` / 15 MB) | Backend | Local / production `.env` |
| Application Config | `PORTFOLIO_MAX_VIDEO_BYTES` | Maximum file size in bytes for a single highlight video upload | Optional (default: `104857600` / 100 MB) | Backend | Local / production `.env` |

---

## 2. Step-by-Step Cloudinary Account Setup

1. **Create or Sign In to Cloudinary**:
   - Sign in at [https://console.cloudinary.com](https://console.cloudinary.com).
   - Select **Programmable Media** from the left navigation bar.
2. **Locate Your Credentials**:
   - Open **Settings** (gear icon in the bottom-left sidebar) → **Access Keys** (or click **View API Keys** on the Programmable Media Dashboard).
   - Copy the three core values:
     - **Cloud Name** → `CLOUDINARY_CLOUD_NAME`
     - **API Key** → `CLOUDINARY_API_KEY`
     - **API Secret** → `CLOUDINARY_API_SECRET`
3. **How Each Credential Is Used**:
   - `CLOUDINARY_CLOUD_NAME`: Identifies the target Cloudinary cloud when constructing the direct upload endpoint (`https://api.cloudinary.com/v1_1/<cloud_name>/<resource_type>/upload`) and public CDN URLs.
   - `CLOUDINARY_API_KEY`: Identifies which access key pair signed the upload request. It is safe to include in the signed upload parameters sent to the authenticated admin browser.
   - `CLOUDINARY_API_SECRET`: **Strictly confidential.** Stored only on the NestJS backend. When an authenticated `OWNER` or `COORDINATOR` requests `/catalog/portfolio-events/:id/upload-signature`, the backend signs the scoped upload parameters (`allowed_formats`, `context`, `folder`, `timestamp`, and optional `upload_preset`) using SHA-1 and returns only the computed `signature`—never the secret itself.
4. **Optional Signed Upload Preset (`CLOUDINARY_UPLOAD_PRESET`)**:
   - Because the NestJS backend already signs `folder`, `allowed_formats`, `context`, and `timestamp` directly, an upload preset is **optional**.
   - If you choose to enforce a preset in Cloudinary (**Settings → Upload → Upload Presets → Add Upload Preset**):
     - **Preset Name**: e.g. `softilo_portfolio_signed`
     - **Signing Mode**: Must be set to **Signed** (do **not** use Unsigned presets).
     - **Folder**: Leave blank (so the backend-signed `softilo/portfolio/<eventId>` folder takes precedence) or match your `CLOUDINARY_FOLDER_PREFIX`.
     - **Unique filename / Overwrite**: Keep **Use filename or externally defined Public ID** enabled and **Unique filename** enabled.
     - Set `CLOUDINARY_UPLOAD_PRESET="softilo_portfolio_signed"` in the backend `.env`.

---

## 3. Where to Configure Credentials (Local vs. Production)

### Local Development
1. Copy `.env.example` to `.env` in `event-management-server/`:
   ```bash
   cp .env.example .env
   ```
2. Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` in `event-management-server/.env`.
3. Do **not** place `CLOUDINARY_API_SECRET` in the Next.js frontend `.env` or any `NEXT_PUBLIC_*` variable. The frontend requests short-lived signed upload parameters from the NestJS backend over authenticated server actions.

### Production Deployment
1. Store `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` in your hosting platform's encrypted environment/secret store (e.g., Railway Variables, Render Environment, Docker/Kubernetes Secret, or AWS/GCP Secret Manager) for the **NestJS backend service**.
2. Never commit `.env` files, real API keys, or secrets to Git, Markdown docs, logs, or test fixtures.

---

## 4. Credential Rotation & Single-Tenant Client Isolation

### Rotating `CLOUDINARY_API_SECRET` Without Downtime
1. In the Cloudinary Console, navigate to **Settings → Access Keys**.
2. Click **Generate New Access Key** to create a second active `(API Key, API Secret)` pair.
3. Update `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` in your production backend secret manager with the new pair and redeploy/restart the NestJS backend.
4. Verify a test upload in the Admin Dashboard.
5. Return to **Settings → Access Keys** in Cloudinary and **Disable / Delete** the old access key pair. Existing published CDN URLs continue working unaffected.

### Single-Tenant White-Label Isolation (Per-Client Deployment)
Softilo Event Management uses a single-tenant clone-and-deploy architecture where each studio client has an isolated deployment and database:
- **Recommended (Strict Account/Sub-Account Isolation)**: Provision a separate Cloudinary account or separate Cloudinary **Product Environment (Sub-Account)** per studio client deployment, each with its own `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`.
- **Minimum Folder & Key Isolation**: Always generate a dedicated Access Key pair per deployment and set a unique `CLOUDINARY_FOLDER_PREFIX` (e.g., `CLOUDINARY_FOLDER_PREFIX="wedding-photoart/portfolio"`) so one client deployment can never sign or register assets outside its own namespace.

---

## 5. Operator Guide: Unpublish, Archive & Direct CDN URL Behavior

- **Draft (`DRAFT`)**: Visible only inside `Admin Dashboard → Portfolio`. Excluded from `/public/portfolio/events` and `/public/portfolio/events/:slug`.
- **Publish (`PUBLISHED`)**: Requires at least one `READY` cover image (`IMAGE`). Immediately appears on the public portfolio page and event detail view; Next.js public caches (`/`, `/portfolio`, `/portfolio/[slug]`) are revalidated automatically.
- **Unpublish (`PUBLISHED → DRAFT`) & Archive (`ARCHIVED`)**:
  - Clicking **Unpublish** or **Archive** in the Admin Dashboard immediately removes the event from `/public/portfolio/events` and `/public/portfolio/events/:slug`, and refreshes the Next.js public page cache so visitors can no longer browse the event on the website.
  - **Direct CDN URL Notice**: Because public showcase media uses standard Cloudinary CDN delivery (`https://res.cloudinary.com/<cloud_name>/...`) for fast global caching and responsive transformations, anyone who previously copied a direct asset URL before unpublishing may still be able to fetch that asset from Cloudinary's CDN edge cache until the edge cache expires. To permanently revoke direct URL access to a sensitive file, remove the asset from the Cloudinary Media Library (with **Invalidate CDN cache** checked).

---

## 6. End-to-End Setup Verification Checklist

Run through these 6 steps after configuring `.env` to verify a deployment:

1. **Missing Credential Check (Safety Verification)**:
   - Temporarily leave `CLOUDINARY_API_SECRET` unset and attempt to upload a photo in **Admin Dashboard → Portfolio → Create Event**.
   - Confirm the backend rejects the request with code `MISSING_CLOUDINARY_CREDENTIALS` and lists only the missing variable name (`CLOUDINARY_API_SECRET`), without exposing any configured values.
2. **Test Photo Upload**:
   - Restore all 3 Cloudinary variables in `.env`, create a draft event (`title`, `slug`, `eventDate`, `description`), and drag-and-drop 2–3 photos (`.jpg` / `.webp`).
   - Verify per-file progress bars reach 100%, status becomes `READY`, the first ready photo is automatically selected as Cover, and you can edit `caption`, `altText`, cover selection, and display order.
3. **Test Video Upload**:
   - Upload a short highlight video (`.mp4` / `.webm`).
   - Verify that if a single file fails, already-uploaded photos remain intact without re-uploading, and the failed item shows its individual **Retry** and **Remove** buttons.
4. **Preview**:
   - Click **Preview Showcase** in the dashboard editor to inspect the cover, responsive gallery grid, and video poster before publishing.
5. **Publish & Mobile Playback**:
   - Click **Publish Event** (verified to require at least 1 `READY` cover image).
   - Open the public portfolio page on mobile/desktop or DevTools Network tab:
     - Confirm the cover image loads with responsive Cloudinary transformations (`f_auto,q_auto`).
     - Confirm the highlight video displays a lightweight JPEG poster (`so_auto,f_jpg,q_auto`) and Play button, and **zero video file bytes are downloaded before clicking Play**.
     - Click **Play** and confirm smooth inline video playback (`playsInline`).
6. **Unpublish**:
   - Click **Unpublish** (or **Archive**) in the Admin Dashboard and verify the event immediately disappears from the public portfolio listing and `/portfolio/<slug>`.
