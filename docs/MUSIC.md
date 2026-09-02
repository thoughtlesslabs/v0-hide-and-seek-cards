# Music production notes

The soundtrack was generated as original instrumental music in the Thoughtless Labs Suno Pro account on July 14, 2026. Store the downloaded masters in `assets/music-masters/`; the normalized, mobile-ready files used by the app live in `public/assets/music/`.

| App scene | Suno title | Suno clip ID | App file |
| --- | --- | --- | --- |
| Menu | Haunted Scorecard | `bed9658f-1ae1-4a05-8367-2973483ede59` | `menu.mp3` |
| Tutorial | Haunted Scorecard, alternate | `69f2ad9c-9696-4114-ad0a-7bca3f631542` | `tutorial.mp3` |
| Lobby | Backstage Cobweb Clock | `d2049f5c-b9a5-46a5-9ad4-6f477cca186a` | `lobby.mp3` |
| Gameplay | Midnight Game Board | `e3d58937-6b4e-43d6-afc8-f407faf98279` | `game.mp3` |
| Panic | Midnight Game Board, accelerated mix | derived from gameplay master | `game-panic.mp3` |
| Victory | Coffin Cup Finale | `88c5c54b-97e2-4f27-8875-af9629a2a50e` | `victory.mp3` |

Background scenes are normalized to approximately -20 LUFS. Panic and victory are intentionally louder at approximately -17 and -18 LUFS. The app applies the player's music-volume preference after loading a track.

The invalid `.m4a` files sometimes returned by Suno's encrypted player stream are ignored. Use Suno's MP3 Download action or its resulting `cdn1.suno.ai/<clip-id>.mp3` asset when remastering.
