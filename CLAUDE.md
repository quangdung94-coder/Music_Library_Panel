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
- `multicam_sync.py`: chế độ "Nhiều máy quay" (ghép 2–4 máy bằng audio, dùng `sync_engine.py`). Ngưỡng đã chỉnh theo dữ liệu thật 08/11, không đổi khi chưa hỏi.
  `main.js`: `mc:run` (chạy Python), `mc:tc` (Sync bằng timecode, chỉ JS), `mc:bin`, `mc:build` (dựng timeline), `mc:csv`.

## Thử nghiệm
- KHÔNG chạy `main.js` trực tiếp trong repo (thiếu `WorkflowIntegration.node`). Muốn thử thật: chép file vào thư mục plugin
  (giữ nguyên `WorkflowIntegration.node` ở đó), nhờ người dùng tắt hẳn Resolve và mở lại panel.
- Kiểm tra cú pháp: biên dịch thử bằng `vm.Script` với Electron của Resolve (`ELECTRON_RUN_AS_NODE=1`), không chạy file.
- Có thể chạy bản sao `main.js` ở thư mục nháp với `electron` và `./WorkflowIntegration.node` giả (Module._load) để thử logic dựng timeline.
  Giả lập phải làm tròn độ dài clip XUỐNG (Resolve: 59.94 fps → 25 fps lấy phần nguyên) mới khớp timeline thật.
- Project thử: `2026.10.25.LV_NgocQuynh`, bin `01_Le sang/01_Sync Cam`, `02_Tiec Toi/02_Sync Cam`; timeline mốc
  `multicam_01_Le sang` (222 clip: 104 Green/37 Lime/81 Yellow, 76.85 phút), `multicam_02_Tiec Toi` (417: 41/73/303, 113.61 phút). Không ghi đè 2 timeline này.

## Kỹ thuật DaVinci (xem thêm ghi chú bên project VideoAI `D:\VideoAI\repo\CLAUDE.md`)
- Import dùng `MediaStorage.AddItemListToMediaPool` (`MediaPool.ImportMedia` từng lỗi).
- Chặn trùng: `poolIndex()` quét cả Media Pool, ưu tiên bin đích (02_music / 03_sfx kể cả bin con).
  + Media bỏ qua file đã có; + Timeline dừng hẳn và chỉ báo.
- Bên VideoAI đã đo: `AppendToTimeline` endFrame KHÔNG tính (truyền frame ngay sau điểm ra).
- Multicam: luôn đặt nguyên clip (`startFrame: 0`, `endFrame: Frames`), không dùng/không sửa In/Out trong Media Pool.
  `trackIndex` đặt cùng lúc Vn/An. Chia màn hình: ZoomX/ZoomY 0.5, Pan ∓rộng/4, Tilt ±cao/4; Tilt DƯƠNG = hàng TRÊN (đã thử 08/11).
  Màu: green→Green, lime→Lime, yellow→Yellow, red (xen theo tên file)→Orange.
