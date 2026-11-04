# Dự án: Panel Music + Audio Sync (DaVinci Resolve Studio)

## Mục tiêu
Panel Workflow Integration cho DaVinci Resolve Studio: thư viện nhạc/SFX (tìm, nghe, đặt In/Out,
đưa vào Media Pool/Timeline) và tab Audio Sync (ghép tiếng thu rời vào clip máy quay).

## Quy tắc làm việc
- Chỉ dùng cá nhân. Trả lời bằng tiếng Việt, người dùng không chuyên IT: giải thích dễ hiểu.
- Sửa code ở folder này (`Music_Library_Panel/`), không sửa thẳng bản đã cài trong ProgramData.
- Đổi cách dùng hay cách cài thì cập nhật luôn `README_CAI_DAT.txt` và `LUU_Y_KHI_CAI_PANEL.txt`.
- Cuối mỗi lần sửa, làm đủ theo thứ tự:
  1. Ghi `CHANGELOG.md` (ngày, đã đổi gì, đã thử trên Resolve thật chưa).
  2. Cài vào Resolve: so sánh từng file với thư mục plugin đã cài rồi chép các file khác
     (không đụng `WorkflowIntegration.node`). Nhắc người dùng tắt hẳn rồi mở lại Resolve.
  3. Commit và đẩy GitHub (kho riêng tư `quangdung94-coder/Music_Library_Panel`, nhánh `main`).
  4. Cập nhật trang Notion "Panel Music + Audio Sync (DaVinci Resolve Studio)":
     mục Chức năng chính, Ghi chú kỹ thuật, checklist Chưa kiểm tra, và thêm một dòng vào Nhật ký thay đổi.
     Trang này để Claude bên claude.ai nắm được tình trạng giống bên Claude Code.
- Trước khi xóa, ghi đè dữ liệu người dùng hay cài thứ gì lớn: hỏi người dùng trước.

## Môi trường
- Windows, DaVinci Resolve Studio 21. GitHub CLI: `C:\Program Files\GitHub CLI\gh.exe` (Bash không có trong PATH).
- Thư mục plugin đã cài: `C:\ProgramData\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\Music_Library_Plugin`
- Dữ liệu panel: `Documents\MusicPanel\library.json` (không đưa lên Git).
- Thư mục nhạc máy chính: `D:\02_music`, SFX: `D:\03_sfx`.

## Cấu trúc
- `main.js`: Resolve API (import Media Pool/Timeline, chặn trùng, Audio Sync tạo timeline), quét thư mục, gọi Python.
- `preload.js`: cầu nối `window.musicAPI`. `index.html`: toàn bộ giao diện 3 tab.
- `analyze_music.py` (librosa): BPM, năng lượng, highlight. `sync_engine.py` + `sync_runner.py` (numpy, imageio-ffmpeg): Audio Sync.

## Kỹ thuật DaVinci (xem thêm ghi chú bên project VideoAI `D:\VideoAI\repo\CLAUDE.md`)
- Import dùng `MediaStorage.AddItemListToMediaPool` (`MediaPool.ImportMedia` từng lỗi).
- Chặn trùng: `poolIndex()` quét cả Media Pool, ưu tiên bin đích (02_music / 03_sfx kể cả bin con).
  + Media bỏ qua file đã có; + Timeline dừng hẳn và chỉ báo.
- Bên VideoAI đã đo: `AppendToTimeline` endFrame KHÔNG tính (truyền frame ngay sau điểm ra).
