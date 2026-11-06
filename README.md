# Driver Tracker

Drivers log in on their phone, start work with a photo, send Loading, Unloading, Breakdown or Other photos, and end work with a photo. Each photo saves the time and GPS location. Drivers can see their own attendance, hours and photos for the last 30 days. The admin sees status, breakdown alerts, routes on a map, photos and a report, and can add, edit or delete any entry. All times use Dubai time and a 24 hour clock. A night shift belongs to the date it started: entries after midnight stay on that date while the shift is open (up to 18 hours after START), and the admin can add an entry for "Next day" when a driver forgot END after midnight. The report has one row per driver per day, with a column for each photo.

## Run on this computer

1. Copy `.env.example` to `.env` and set `ADMIN_PASSWORD` (minimum 10 characters).
2. `npm install`
3. `npm run dev`
4. Driver app: http://localhost:3000  Admin: http://localhost:3000/admin

## Put it online

Phones allow camera and GPS only on HTTPS, so the site needs a host with an HTTPS domain and a MongoDB database. Set the `.env` values on the host, then run `npm run build` and `npm start`.

## Images

Images are stored as bytes in the `photoBlobs` collection. Photo details are in `photos`, with the same `_id`. Each photo is about 100-250 KB.
