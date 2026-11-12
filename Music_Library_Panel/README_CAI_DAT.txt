HƯỚNG DẪN CÀI PANEL MUSIC LIBRARY CHO DAVINCI RESOLVE (Windows và macOS) – BẢN v3
======================================================================

Panel có 3 tab: Nhạc, SFX và Audio Sync. Tab Audio Sync có 2 chế độ:
"Recorder → máy quay" và "Nhiều máy quay" (ghép 2–9 máy quay + file Recorder lên một timeline).
"Recorder" là file của máy ghi âm rời (máy nào cũng được).

YÊU CẦU
- DaVinci Resolve STUDIO (bản trả phí). Bản miễn phí không hiện được panel.
- Windows 10/11 hoặc macOS.
- Python + thư viện (cài một lần, xem PHẦN 4): pip install librosa numpy imageio-ffmpeg
  Không cài thì tab Nhạc/SFX vẫn dùng được, chỉ là không tự phân tích BPM và không dùng được tab Audio Sync.

TRONG GÓI NÀY
- Thư mục Music_Library_Plugin (9 file): manifest.xml, package.json, main.js, preload.js, index.html,
  analyze_music.py, sync_engine.py, sync_runner.py, multicam_sync.py.
  Sau khi cài, thư mục plugin trong Resolve có 10 file (thêm WorkflowIntegration.node, bộ cài tự lấy trên máy bạn).
- install_windows.bat, install_mac.command, README_CAI_DAT.txt (file này), LUU_Y_KHI_CAI_PANEL.txt.

------------------------------------------------------------------
PHẦN 1. CÀI PANEL (cách nhanh)
------------------------------------------------------------------
Trước tiên: giải nén file zip này ra một thư mục bất kỳ (ví dụ Desktop).

WINDOWS
1. Bấm đúp file  install_windows.bat
2. Khi Windows hỏi quyền quản trị, bấm Yes.
3. Thấy chữ "CAI DAT XONG" là được.

MACOS
1. Bấm chuột phải vào file  install_mac.command  rồi chọn Open (Mở).
   Nếu máy báo "không xác định được nhà phát triển", bấm Open lần nữa.
2. Nhập mật khẩu đăng nhập của máy Mac khi được hỏi (lúc gõ sẽ không thấy chữ hiện ra, đó là bình thường).
3. Thấy chữ "CAI DAT XONG" là được.

SAU ĐÓ (cả hai hệ điều hành)
4. TẮT HẲN DaVinci Resolve rồi mở lại.
5. Mở panel: menu  Workspace > Workflow Integrations > Music Library

------------------------------------------------------------------
CÁCH CÀI THỦ CÔNG (chỉ dùng khi cách nhanh bị lỗi)
------------------------------------------------------------------
Bước A. Tìm file WorkflowIntegration.node của Blackmagic trên máy:
   Trong Resolve vào menu Help > Documentation > Developer, thư mục mở ra có
   Workflow Integrations > Examples > SamplePlugin. Copy file WorkflowIntegration.node trong đó.
   (Windows: C:\ProgramData\Blackmagic Design\DaVinci Resolve\Support\Developer\Workflow Integrations\Examples\SamplePlugin)

Bước B. Dán file đó vào thư mục Music_Library_Plugin (thư mục nằm cạnh file hướng dẫn này).

Bước C. Chép CẢ thư mục Music_Library_Plugin vào thư mục plugin của Resolve:
   Windows: C:\ProgramData\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\
   macOS:   /Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/
   (Nếu chưa có thư mục "Workflow Integration Plugins" thì tự tạo mới đúng tên đó.)

Bước D. Tắt hẳn rồi mở lại Resolve.

------------------------------------------------------------------
PHẦN 2. LẦN ĐẦU MỞ PANEL
------------------------------------------------------------------
1. Panel sẽ báo "Không tìm thấy thư mục nhạc". Bấm nút có biểu tượng thư mục ở đầu danh sách để chọn:
   - tab Nhạc: chọn thư mục chứa nhạc.
   - tab SFX:  chọn thư mục chứa SFX.
2. Bấm "Quét thư mục" để thêm file vào panel.

------------------------------------------------------------------
PHẦN 3. MANG DANH SÁCH CŨ SANG MÁY MỚI (tag, yêu thích, In/Out, loại video)
------------------------------------------------------------------
Trên máy CŨ, copy file:
   Windows: Documents\MusicPanel\library.json
   macOS:   Documents/MusicPanel/library.json
Trên máy MỚI, tạo thư mục Documents\MusicPanel (nếu chưa có) và dán file đó vào, TRƯỚC KHI mở panel lần đầu.
Rồi mở panel, bấm nút thư mục để chọn lại thư mục nhạc và SFX của máy mới.
Lưu ý: bên trong thư mục nhạc/SFX nên giữ nguyên cách sắp xếp thư mục con như máy cũ.

------------------------------------------------------------------
PHẦN 4. CÀI PYTHON (cho phân tích BPM và tab Audio Sync)
------------------------------------------------------------------
Tab Nhạc/SFX vẫn chạy nếu bạn không cài phần này, chỉ là file mới quét sẽ chưa có BPM và năng lượng,
và tab Audio Sync (cả 2 chế độ) không chạy được.

WINDOWS
1. Cài Python từ trang python.org. Khi cài, TÍCH vào ô "Add python.exe to PATH".
2. Mở Command Prompt (gõ cmd trong menu Start) và gõ:   pip install librosa numpy imageio-ffmpeg

MACOS
1. Cài Python từ trang python.org (bản cài .pkg).
2. Mở Terminal và gõ:   python3 -m pip install librosa numpy imageio-ffmpeg

Nếu Python của bạn nằm ở chỗ khác, tạo file  Documents/MusicPanel/python_path.txt  chỉ chứa
đường dẫn tới file python, ví dụ:   C:\Users\Ten\AppData\Local\Programs\Python\Python310\python.exe

File .aac cần cài thêm ffmpeg mới phân tích được (không bắt buộc).

------------------------------------------------------------------
PHẦN 5. TAB AUDIO SYNC (ghép tiếng thu rời vào clip máy quay)
------------------------------------------------------------------
Tab "Audio Sync" có 2 chế độ (nút ở đầu tab):
- "Recorder → máy quay": ghép file máy ghi âm rời (Recorder) vào đúng vị trí của clip máy quay.
- "Nhiều máy quay": ghép 2–9 máy quay không chung timecode lên một timeline, chia màn hình
  trái/phải hoặc chia lưới (xem mục 12 trong LUU_Y_KHI_CAI_PANEL.txt).
Tab này cần Python + thư viện ở PHẦN 4.

CHẾ ĐỘ "RECORDER → MÁY QUAY"
1. Bấm "+ Chọn file…" hoặc "+ Cả bin đang mở" ở ô 1 để chọn file Recorder (tiếng chuẩn). Được chọn nhiều file;
   bản -12dB của cùng một lần ghi (ví dụ …S34D12.wav) tự được bỏ, chỉ dùng bản thường (…S12.wav).
2. Ở ô 2, chọn clip máy quay: chọn clip trong Media Pool của Resolve rồi bấm
   "Lấy clip đang chọn trong Media Pool", hoặc bấm "+ Chọn file…".
3. Bấm "Phân tích". Đợi thanh tiến trình chạy xong.
4. Xem bảng kết quả. Màu xanh = chắc chắn, vàng/cam = nên nghe kiểm tra lại, đỏ = chưa sync được.
5. Bấm "Tạo timeline đã sync trong Resolve": panel tạo timeline AUDIO_SYNC_ngày_giờ,
   clip máy quay ở V1, tiếng Recorder ở track audio riêng đúng vị trí. Cần đang mở một project.
   Mặc định tiếng gốc của máy quay bị tắt; tick "Giữ tiếng gốc" nếu muốn giữ.
6. "Xuất bảng CSV" để lưu kết quả ra file.
Nên nghe kiểm tra vài clip trước khi dùng cho việc thật.

------------------------------------------------------------------
PHẦN 6. CHẾ ĐỘ "NHIỀU MÁY QUAY" (ghép 2–9 máy quay + Recorder)
------------------------------------------------------------------
Dùng khi quay nhiều máy không chung timecode: panel tự ghép theo sóng âm, xếp liền trên một timeline.
1. Trong Media Pool mở bin chứa clip các máy (ví dụ 02_Sync Cam, có thể có bin con Cam 1 / Cam 2),
   bấm "Tự chia theo tên file". Máy nhiều clip nhất thành Cam 1; bấm ↑ để đổi.
   Hoặc lấy từng máy bằng "Clip đang chọn", "Cả bin", "File…".
2. Hàng Recorder (không bắt buộc): mở bin file ghi âm (ví dụ 07_audio) rồi bấm "Cả bin".
   Panel tự ghép cặp bản thường và bản -12dB, hiện ví dụ "6 bản ghi · 12 file (thường + -12dB)".
3. Chọn cách ghép: "Sync bằng audio" (thường dùng) hoặc "Sync bằng timecode" (khi các máy chung timecode).
4. Công tắc "Gap lại": bỏ khoảng trống. "Chia màn hình": 2 máy trái/phải, 3–4 máy lưới 2×2, 5–6 máy 3×2, 7–9 máy 3×3.
5. Đặt tên timeline (không trùng timeline đã có), bấm "Phân tích" rồi "Tạo timeline".
Kết quả trên timeline:
- Cam 1 ở V1/A1, Cam 2 ở V2/A2… Màu clip: xanh lá = khớp audio chắc, xanh nhạt = khớp vừa (nên nghe lại),
  vàng = đặt theo giờ máy đã chỉnh, cam = xen theo số tên file.
- Recorder ở track audio ngay sau các máy quay (2 máy: A3), màu Teal. Tick "Kèm bản -12dB" thì bản -12dB
  nằm cùng vị trí ở A4, màu Navy. Khi bật Gap lại, Recorder được cắt theo đúng các đoạn có máy quay.
- Panel đặt nguyên clip, không dùng và không sửa điểm In/Out bạn đã đánh trong Media Pool.
Chi tiết thêm: mục 12 trong LUU_Y_KHI_CAI_PANEL.txt.

------------------------------------------------------------------
XÓA PANEL
------------------------------------------------------------------
Xóa thư mục Music_Library_Plugin trong thư mục plugin của Resolve (đường dẫn ở Bước C), rồi mở lại Resolve.
Danh sách của bạn vẫn còn trong Documents/MusicPanel/library.json.
