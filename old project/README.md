# FamiList

A collaborative shopping list application built with pure HTML, CSS, and JavaScript.

## Features

- **Multiple Lists**: Create, rename, duplicate, archive, and delete lists
- **Collaborative**: Support for multiple members per list with roles (Owner/Editor/Viewer)
- **Item Management**: Add, edit, archive, restore, and delete items
- **Quantities**: Track quantities per member per item
- **Done Status**: Mark items as done per member
- **Comments**: Add comments to items
- **Drag & Drop**: Reorder items with drag and drop
- **Hide Done Filter**: Toggle visibility of completed items per member
- **Export/Import**: Export lists to JSON files and import them
- **Offline Support**: All data stored in localStorage
- **Accessibility**: Full ARIA support and keyboard navigation

## Project Structure

```
shopping-list/
├── index.html           # Main HTML (legacy script)
├── index.module.html    # HTML for ES modules version
├── styles.css           # All CSS with CSS variables
├── script.js            # Legacy single-file script
├── package.json         # npm configuration
├── vite.config.js       # Vite build configuration
└── src/                 # Modular source files
    ├── main.js          # Entry point
    ├── types.js         # JSDoc type definitions
    ├── utils.js         # Utility functions
    ├── messages.js      # i18n message strings
    ├── errors.js        # Error handling & toasts
    ├── permissions.js   # Auth/permission utilities
    ├── validators.js    # Validation logic
    ├── migrations.js    # State migration logic
    ├── store.js         # Centralized state management
    ├── data-service.js  # Data persistence abstraction
    ├── list-manager.js  # ListManager class
    └── list-editor.js   # FamiList (list editor) class
```

## Quick Start

### Using Legacy Script (No Build Required)

Simply open `index.html` in a browser. All functionality works from the single `script.js` file.

### Using Modular Version (With Vite)

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start development server:
   ```bash
   npm run dev
   ```

3. Open `http://localhost:3000` in your browser

4. Build for production:
   ```bash
   npm run build
   ```

## Architecture Overview

### Data Layer (`data-service.js`)

Provides a unified interface for data operations, currently using localStorage but designed to be swapped with an API implementation:

```javascript
// Current implementation
const dataService = new LocalStorageDataService();

// Future online implementation
const dataService = new ApiDataService('https://api.example.com');
```

### State Management (`store.js`)

Centralized state with pub/sub pattern:

```javascript
import { store, actions, selectors } from './store.js';

// Read state
const lists = selectors.getActiveLists();

// Update state
actions.addList(newList);

// Subscribe to changes
store.subscribe((state, prevState) => {
  if (state.lists !== prevState.lists) {
    // React to list changes
  }
});
```

### Permissions (`permissions.js`)

Prepared for future authentication:

```javascript
import { canEditList, canDeleteMember } from './permissions.js';

// Check permissions (currently returns true for all)
if (canEditList(list, userId)) {
  // Allow edit
}

// With auth in future
const permission = canDeleteMember(list, memberId, userId);
if (!permission.allowed) {
  showError(permission.reason);
}
```

### Error Handling (`errors.js`)

Toast notifications and error management:

```javascript
import { toast, handleError, AppError, ErrorCodes } from './errors.js';

// Show notifications
toast.success('List saved!');
toast.error('Failed to save');
toast.warning('Connection lost');
toast.info('New version available');

// Throw app errors
throw new AppError('Invalid data', ErrorCodes.VALIDATION_FAILED);

// Handle errors consistently
handleError(error);
```

### Internationalization (`messages.js`)

All user-facing strings centralized:

```javascript
import { t } from './messages.js';

// Simple strings
const title = t('appTitle');

// With interpolation
const info = t('listInfo', itemCount, memberCount);

// In HTML
`<button>${t('save')}</button>`
```

### Validation (`validators.js`)

Reusable validation functions:

```javascript
import { validateListName, validateImportData, validateAndRepairList } from './validators.js';

// Validate user input
const result = validateListName(name, existingLists);
if (!result.valid) {
  showError(result.error);
}

// Repair corrupted data
const { list, repaired, issues } = validateAndRepairList(rawList);
```

## CSS Variables (Theming)

The CSS uses variables for easy theming:

```css
:root {
  --color-primary: #667eea;
  --color-success: #28a745;
  --color-error: #dc3545;
  --spacing-md: 12px;
  --radius-lg: 8px;
  /* ... etc */
}
```

## Future Improvements

### Priority 1: API Integration
- Implement `ApiDataService` class
- Add authentication flow
- Implement real-time sync with WebSockets

### Priority 2: Offline-First PWA
- Service Worker for offline support
- IndexedDB for larger data storage
- Sync queue for offline changes

### Priority 3: Enhanced UX
- Optimistic updates
- Undo/redo history
- Search and filter

## Browser Support

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

## License

MIT
