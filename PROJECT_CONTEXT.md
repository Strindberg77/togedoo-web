# ToGeDoo - Project Context for Claude

## Current Status (October 19, 2025)

### Completed
- ✅ Next.js website deployed on Vercel (https://togedoo-web.vercel.app)
- ✅ API endpoint working (/api/activities?city=oslo)
- ✅ Flutter app integrated with API (tested - 3 activities loading)
- ✅ DNS setup done (togedoo.com → A record 216.198.79.1, www → CNAME cname.vercel-dns.com)
- ✅ Data structure ready (data/activities.json with Oslo, Bergen)

### Architecture
- **Frontend:** Next.js 15 + TypeScript + Tailwind CSS
- **UI Components:** Basic (will upgrade to Shadcn/ui next)
- **API:** Node.js/Express-style endpoints in /pages/api
- **Data Source:** Static JSON (data/activities.json)
- **Deployment:** Vercel (auto-deploy on git push)
- **Mobile App:** Flutter + Provider pattern
- **Database:** Firebase (for app auth, not website)

### File Structure
```
togedoo-web/
├── app/
│   ├── page.tsx (homepage with Oslo/Bergen selector)
│   ├── api/
│   │   └── activities/
│   │       └── route.ts (API endpoint)
│   └── layout.tsx
├── data/
│   └── activities.json (Oslo/Bergen activities)
├── public/
└── package.json
```

### Data Format
```json
{
  "oslo": {
    "city": "Oslo",
    "activities": [
      {
        "id": 1,
        "title": "Naturhistorisk Museum",
        "age": "3-10 år",
        "image": "🏛️",
        "description": "Utforsk dinosaurer og naturens mysterier"
      }
    ]
  }
}
```

### Flutter Integration
- File: `lib/services/togedoo_web_service.dart`
- Fetches from: https://togedoo-web.vercel.app/api/activities?city=oslo
- Provider: `ActivityProvider` (lib/services/activity_provider.dart)
- Test screen: TestActivitiesScreen (works - displays 3 activities)

### Next Steps (Priority Order)
1. **Upgrade UI to Shadcn/ui** - Make website professional for global scale
2. Add more cities (Trondheim, Stavanger, Kristiansand, etc)
3. Implement filtering/search
4. Add admin panel for data management
5. Internationalization (i18n) setup
6. Performance optimization

### Important Notes
- DNS will fully propagate in 24-48 hours (togedoo.com live)
- Domeneshop nameservers NOT compatible with Vercel for .com domains - using A-record instead
- Flutter app works with Vercel URL directly (no DNS needed for app)
- System is scalable to 100+ cities without architecture changes

### Domains & URLs
- Website: togedoo.com (DNS pending full propagation)
- Vercel URL: https://togedoo-web.vercel.app (active)
- API: https://togedoo-web.vercel.app/api/activities?city={city}
- Flutter app: Connects to Vercel API

### GitHub Repos
- Website: https://github.com/Strindberg77/togedoo-web
- App: ~/togedoo_modern (local)