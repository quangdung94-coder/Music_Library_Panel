# Nhật ký thay đổi

## 08/11/2026 (tối) – Đóng gói bản v3
- Tạo 2 bản zip từ code hiện tại, lưu ở `E:\Kho dữ liệu\Tài nguyên\` (KHÔNG đưa vào repo):
  - `Music_Library_Panel_v3.zip`: bản đầy đủ, giữ sẵn danh sách 227 bài (biến `SEED` trong `index.html`, giống bản v2 đầy đủ).
  - `Music_Library_Panel_v3_ban_sach.zip`: danh sách nhạc trống (`const SEED = [];`), dùng cho máy khác.
  - Mỗi bản 13 file: thư mục `Music_Library_Plugin` (9 file, có `multicam_sync.py`) + 2 file cài + 2 file hướng dẫn.
    Không có `WorkflowIntegration.node`, `library.json`, `python_path.txt`, `__pycache__`.
    `install_mac.command` giữ xuống dòng LF và quyền chạy.
  - Đã giải nén thử cả 2 bản: đủ file, không có file cấm, 12 file giống hệt repo, zip không lỗi.
- README_CAI_DAT.txt và LUU_Y_KHI_CAI_PANEL.txt: thêm phần chế độ "Nhiều máy quay" + Recorder (A3, bản -12dB ở A4),
  thư viện Python gộp một lệnh `pip install librosa numpy imageio-ffmpeg`, thư mục plugin giờ có 10 file,
  gọi máy ghi âm rời là "Recorder".

## 08/11/2026 (chiều) – Nhiều file Recorder, đặt ở A3
- Đã kiểm tra timeline anh dựng bằng panel trên Resolve thật (`multicam_01_Sync Cam`): 222/222 clip trùng vị trí
  từng frame với timeline 08/11, cùng màu, cùng độ dài, 0 khoảng trống.
- Hàng Recorder nhận nhiều file (Cả bin / Clip đang chọn / File…), tự ghép cặp bản thường `…S12` và bản -12dB `…S34D12`;
  chỉ phân tích bản thường. Chế độ "Recorder → máy quay" cũng nhận cả bin và tự bỏ bản -12dB.
- `multicam_sync.py`: Recorder là một "máy" chỉ có audio. Không dùng giờ của Recorder để chỉnh giờ máy (kết quả máy quay
  không đổi khi không có Recorder: chạy lại 2 buổi vẫn y hệt 08/11). Recorder không khớp clip nào thì bỏ.
  Bật Gap lại: Recorder bị cắt theo các đoạn có máy quay (trả về từng đoạn: giây bắt đầu trong file + độ dài).
  Bảng kết quả ghi clip nào "Khớp qua Recorder".
- Dựng timeline: Recorder ở A(số máy + 1) màu Teal, tùy chọn bản -12dB ở track kế tiếp màu Navy. File audio có Frames rỗng:
  startFrame/endFrame tính theo frame timeline, endFrame không tính. Đặt máy quay trước, Recorder sau; đoạn Recorder được cắt
  gọn trong đoạn có máy quay, chạm đoạn trước thì cắt bớt đầu (không đẩy lùi) để tiếng không lệch hình.
- "Tự chia theo tên file" chia theo bin con khi bin có bin con (Cam 1 / Cam 2).
- Đã thử bằng giả lập Resolve với Tiệc tối + 07_audio: 6 bản ghi / 12 file nhận đúng cặp; 3 bản ghi khớp (0262, 0263, 0264),
  3 bản không khớp (0259, 0260, 0261: không có cặp nào đạt ngưỡng); xanh lá 41 → 76; 101 đoạn Recorder ở A3, A4 trùng vị trí A3;
  0 khoảng trống, 0 cụm lệch, 0 đoạn Recorder lấn ra ngoài. Tắt Gap lại: 3 file nguyên, 0 cụm lệch.
- Đã thử trên Resolve thật (anh dựng `multicam_02_Sync Cam` bằng panel): 417 clip 76/45/296 đúng từng clip so với phân tích,
  A3 "Recorder" 101 đoạn Teal, 113,6 phút, 0 khoảng trống, 0 đoạn Recorder lấn ra ngoài; 68 chỗ video và Recorder phát cùng lúc
  lệch 0 frame (52) hoặc 1 frame (16). Chưa thử ô "Kèm bản -12dB" (A4) trên Resolve thật.

## 08/11/2026 – Multicam Sync trong tab Audio Sync
- Tab Audio Sync có 2 chế độ: "Recorder → máy quay" (chức năng cũ, đổi tên) và "Nhiều máy quay" (mới).
  Giao diện không còn chữ "Tascam"; máy ghi âm rời gọi chung là "Recorder".
- `multicam_sync.py` (bộ ghép 08/11) chép vào plugin, giữ nguyên thuật toán và ngưỡng. Thêm: tự tìm
  `sync_engine.py` cạnh nó, tham số `close_gaps` (công tắc Gap lại), hàng Recorder làm trục chính.
  Chạy lại 2 buổi NgocQuynh cho kết quả y hệt 08/11 (222 và 417 clip, không clip nào khác vị trí/màu).
- Nhiều máy quay: 2–4 máy + Recorder; nút Tự chia theo tên file / Cả bin / Clip đang chọn / File…;
  Sync bằng audio (có "Dùng giờ máy đã chỉnh") hoặc bằng timecode (Start TC); công tắc Gap lại, Chia màn hình;
  bảng kết quả, Xuất CSV, Tạo timeline (bin 03_timeline, không ghi đè timeline trùng tên).
- Dựng timeline theo bài học 08/11: startFrame 0, endFrame = Frames; dồn khe 1–2 frame; Pan ∓480;
  lưới 2×2 thêm Tilt ±270 (đã thử dấu trên Resolve thật: Tilt +270 = hàng trên); tô màu, đặt tên track;
  tự kiểm tra khoảng trống và cụm lệch sau khi dựng.
- Tab Nhạc: bấm Next/Prev thì danh sách tự cuộn tới bài đang phát.
- Đã thử: chạy main.js trong môi trường giả lập Resolve (Python thật, footage thật). Lễ sáng 222/222 clip
  trùng vị trí từng frame với timeline 08/11; Tiệc tối 417 clip lệch tối đa 1 frame; cùng màu, cùng độ dài,
  0 khoảng trống. Thử thêm: tắt Gap lại, tắt Chia màn hình, 3 máy, timecode, Recorder, trùng tên.
  Giả lập bắt được 1 lỗi (lấy nhầm clip từ chỉ mục Media Pool), đã sửa.
- CHƯA thử bấm trong panel trên Resolve thật.

## 04/11/2026
- Đưa mã nguồn lên GitHub (kho riêng tư `quangdung94-coder/Music_Library_Panel`).
- Thêm `CLAUDE.md`: quy trình cuối mỗi lần sửa (CHANGELOG, cài vào Resolve, GitHub, Notion).

## 03/11/2026
- Chặn import trùng theo bin: file đã có trong 02_music / 03_sfx (kể cả bin con) hoặc chỗ khác trong Media Pool
  thì báo "đã tồn tại trong bin …". + Media bỏ qua file đó; + Timeline dừng hẳn, không đặt vào timeline.
- Đã chép `main.js` vào thư mục plugin. Chưa thử trên Resolve thật.
