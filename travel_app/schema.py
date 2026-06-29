from .auth import AuthService
from .config import DEFAULT_ADMIN_PASSWORD, SUPER_ADMIN_EMAIL
from .db import db_cursor


DESTINATION_SUGGESTION_SEED = [
    ("Hạ Long", "Quán ăn ngon", "Nhà hàng Hồng Hạnh 3", "Hạ Long, Quảng Ninh", "Nhà hàng hải sản nổi tiếng, phù hợp nhóm đông.", "https://www.google.com/maps/search/Nhà+hàng+Hồng+Hạnh+3+Hạ+Long"),
    ("Hạ Long", "Quán ăn ngon", "Nhà hàng Cua Vàng", "Hạ Long, Quảng Ninh", "Gợi ý hải sản, lẩu cua, món địa phương.", "https://www.google.com/maps/search/Nhà+hàng+Cua+Vàng+Hạ+Long"),
    ("Hạ Long", "Cà phê đẹp", "Sky Bar Hạ Long", "Bãi Cháy, Hạ Long", "Không gian ngắm vịnh, hợp đi buổi tối.", "https://www.google.com/maps/search/Sky+Bar+Hạ+Long"),
    ("Hạ Long", "Vui chơi", "Sun World Hạ Long", "Bãi Cháy, Hạ Long", "Khu vui chơi lớn, cáp treo, vòng quay, công viên.", "https://www.google.com/maps/search/Sun+World+Hạ+Long"),
    ("Hạ Long", "Khám phá", "Vịnh Hạ Long", "Hạ Long, Quảng Ninh", "Tour tham quan vịnh, hang động, chèo kayak.", "https://www.google.com/maps/search/Vịnh+Hạ+Long"),
    ("Đà Nẵng", "Quán ăn ngon", "Bánh tráng cuốn thịt heo Trần", "Đà Nẵng", "Món đặc sản dễ ăn, hợp nhóm gia đình.", "https://www.google.com/maps/search/Bánh+tráng+cuốn+thịt+heo+Trần+Đà+Nẵng"),
    ("Đà Nẵng", "Quán ăn ngon", "Mì Quảng Bà Mua", "Đà Nẵng", "Mì Quảng, bánh tráng cuốn, món miền Trung.", "https://www.google.com/maps/search/Mì+Quảng+Bà+Mua+Đà+Nẵng"),
    ("Đà Nẵng", "Cà phê đẹp", "Wonderlust Bakery & Coffee", "Đà Nẵng", "Không gian sáng, dễ ngồi nghỉ trong trung tâm.", "https://www.google.com/maps/search/Wonderlust+Bakery+Coffee+Đà+Nẵng"),
    ("Đà Nẵng", "Vui chơi", "Bà Nà Hills", "Hòa Vang, Đà Nẵng", "Khu du lịch cáp treo, Cầu Vàng, vui chơi cả ngày.", "https://www.google.com/maps/search/Bà+Nà+Hills"),
    ("Đà Nẵng", "Khám phá", "Ngũ Hành Sơn", "Đà Nẵng", "Hang động, chùa, điểm ngắm thành phố.", "https://www.google.com/maps/search/Ngũ+Hành+Sơn+Đà+Nẵng"),
    ("Cát Bà", "Quán ăn ngon", "Nhà hàng Phương Phương", "Cát Bà, Hải Phòng", "Hải sản và món địa phương gần khu trung tâm.", "https://www.google.com/maps/search/Nhà+hàng+Phương+Phương+Cát+Bà"),
    ("Cát Bà", "Quán ăn ngon", "Quiri Pub Cocktail & Restaurant", "Cát Bà, Hải Phòng", "Đồ ăn, đồ uống, hợp nhóm bạn.", "https://www.google.com/maps/search/Quiri+Pub+Cat+Ba"),
    ("Cát Bà", "Cà phê đẹp", "Like Coffee Cát Bà", "Cát Bà, Hải Phòng", "Gợi ý cà phê nghỉ chân gần trung tâm.", "https://www.google.com/maps/search/Like+Coffee+Cát+Bà"),
    ("Cát Bà", "Vui chơi", "Vịnh Lan Hạ", "Cát Bà, Hải Phòng", "Đi thuyền, kayak, tắm biển, tour trong ngày.", "https://www.google.com/maps/search/Vịnh+Lan+Hạ"),
    ("Cát Bà", "Khám phá", "Vườn quốc gia Cát Bà", "Cát Bà, Hải Phòng", "Trekking, ngắm rừng, phù hợp nhóm thích vận động.", "https://www.google.com/maps/search/Vườn+quốc+gia+Cát+Bà"),
    ("Phú Quốc", "Quán ăn ngon", "Nhà hàng Xin Chào", "Dương Đông, Phú Quốc", "Hải sản, không gian ngắm biển.", "https://www.google.com/maps/search/Nhà+hàng+Xin+Chào+Phú+Quốc"),
    ("Phú Quốc", "Quán ăn ngon", "Bún quậy Kiến Xây", "Phú Quốc", "Món địa phương nổi tiếng, phù hợp ăn nhanh.", "https://www.google.com/maps/search/Bún+quậy+Kiến+Xây+Phú+Quốc"),
    ("Phú Quốc", "Cà phê đẹp", "Chuồn Chuồn Bistro & Skybar", "Dương Đông, Phú Quốc", "View cao, hợp ngắm hoàng hôn.", "https://www.google.com/maps/search/Chuồn+Chuồn+Bistro+Phú+Quốc"),
    ("Phú Quốc", "Vui chơi", "VinWonders Phú Quốc", "Gành Dầu, Phú Quốc", "Khu vui chơi lớn, đi cả ngày.", "https://www.google.com/maps/search/VinWonders+Phú+Quốc"),
    ("Phú Quốc", "Khám phá", "Grand World Phú Quốc", "Gành Dầu, Phú Quốc", "Đi dạo, chụp ảnh, biểu diễn, ăn uống buổi tối.", "https://www.google.com/maps/search/Grand+World+Phú+Quốc"),
    ("Hội An", "Quán ăn ngon", "Cơm gà Bà Buội", "Hội An, Quảng Nam", "Cơm gà nổi tiếng trong phố cổ.", "https://www.google.com/maps/search/Cơm+gà+Bà+Buội+Hội+An"),
    ("Hội An", "Quán ăn ngon", "Bánh mì Phượng", "Hội An, Quảng Nam", "Bánh mì nổi tiếng, tiện ăn nhanh.", "https://www.google.com/maps/search/Bánh+mì+Phượng+Hội+An"),
    ("Hội An", "Cà phê đẹp", "Faifo Coffee", "Hội An, Quảng Nam", "Không gian phố cổ, có góc ngắm mái nhà.", "https://www.google.com/maps/search/Faifo+Coffee+Hội+An"),
    ("Hội An", "Vui chơi", "Rừng dừa Bảy Mẫu", "Cẩm Thanh, Hội An", "Thuyền thúng, trải nghiệm sông nước.", "https://www.google.com/maps/search/Rừng+dừa+Bảy+Mẫu+Hội+An"),
    ("Hội An", "Khám phá", "Phố cổ Hội An", "Hội An, Quảng Nam", "Đi bộ, chụp ảnh, ăn uống, đèn lồng buổi tối.", "https://www.google.com/maps/search/Phố+cổ+Hội+An"),
    ("Đà Lạt", "Quán ăn ngon", "Lẩu gà lá é Tao Ngộ", "Đà Lạt, Lâm Đồng", "Món lẩu nổi tiếng, hợp ăn tối.", "https://www.google.com/maps/search/Lẩu+gà+lá+é+Tao+Ngộ+Đà+Lạt"),
    ("Đà Lạt", "Quán ăn ngon", "Bánh căn Nhà Chung", "Đà Lạt, Lâm Đồng", "Bánh căn nóng, món địa phương dễ ăn.", "https://www.google.com/maps/search/Bánh+căn+Nhà+Chung+Đà+Lạt"),
    ("Đà Lạt", "Cà phê đẹp", "Kombi Land Coffee", "Đà Lạt, Lâm Đồng", "Không gian chụp ảnh, phong cách sa mạc.", "https://www.google.com/maps/search/Kombi+Land+Coffee+Đà+Lạt"),
    ("Đà Lạt", "Vui chơi", "Datanla Alpine Coaster", "Đà Lạt, Lâm Đồng", "Máng trượt, thác, hoạt động vận động.", "https://www.google.com/maps/search/Datanla+Alpine+Coaster+Đà+Lạt"),
    ("Đà Lạt", "Khám phá", "Quảng trường Lâm Viên", "Đà Lạt, Lâm Đồng", "Điểm check-in trung tâm, dễ ghé.", "https://www.google.com/maps/search/Quảng+trường+Lâm+Viên+Đà+Lạt"),
    ("Nha Trang", "Quán ăn ngon", "Nem nướng Đặng Văn Quyên", "Nha Trang, Khánh Hòa", "Nem nướng nổi tiếng, hợp ăn nhóm.", "https://www.google.com/maps/search/Nem+nướng+Đặng+Văn+Quyên+Nha+Trang"),
    ("Nha Trang", "Quán ăn ngon", "Bún cá Nguyên Loan", "Nha Trang, Khánh Hòa", "Bún cá, món địa phương dễ ăn.", "https://www.google.com/maps/search/Bún+cá+Nguyên+Loan+Nha+Trang"),
    ("Nha Trang", "Cà phê đẹp", "Rainforest Nha Trang", "Nha Trang, Khánh Hòa", "Quán cà phê nhiều cây xanh, hợp nghỉ chân.", "https://www.google.com/maps/search/Rainforest+Nha+Trang"),
    ("Nha Trang", "Vui chơi", "VinWonders Nha Trang", "Hòn Tre, Nha Trang", "Khu vui chơi đảo, phù hợp cả ngày.", "https://www.google.com/maps/search/VinWonders+Nha+Trang"),
    ("Nha Trang", "Khám phá", "Tháp Bà Ponagar", "Nha Trang, Khánh Hòa", "Điểm văn hóa, tham quan ngắn.", "https://www.google.com/maps/search/Tháp+Bà+Ponagar+Nha+Trang"),
    ("Sa Pa", "Quán ăn ngon", "Nhà hàng A Phủ", "Sa Pa, Lào Cai", "Món Tây Bắc, cá hồi, thắng cố, lẩu.", "https://www.google.com/maps/search/Nhà+hàng+A+Phủ+Sa+Pa"),
    ("Sa Pa", "Quán ăn ngon", "Moment Romantic Restaurant", "Sa Pa, Lào Cai", "Nhà hàng trung tâm, món Việt và món Âu.", "https://www.google.com/maps/search/Moment+Romantic+Restaurant+Sa+Pa"),
    ("Sa Pa", "Cà phê đẹp", "Viettrekking Coffee", "Sa Pa, Lào Cai", "View núi, săn mây khi thời tiết đẹp.", "https://www.google.com/maps/search/Viettrekking+Coffee+Sa+Pa"),
    ("Sa Pa", "Khám phá", "Fansipan", "Sa Pa, Lào Cai", "Cáp treo, đỉnh Fansipan, đi nửa ngày đến một ngày.", "https://www.google.com/maps/search/Fansipan+Sa+Pa"),
    ("Sa Pa", "Khám phá", "Bản Cát Cát", "Sa Pa, Lào Cai", "Đi bộ, chụp ảnh, trải nghiệm văn hóa địa phương.", "https://www.google.com/maps/search/Bản+Cát+Cát+Sa+Pa"),
    ("Huế", "Quán ăn ngon", "Bún bò Mệ Kéo", "Huế, Thừa Thiên Huế", "Bún bò Huế nổi tiếng, nên kiểm tra giờ bán.", "https://www.google.com/maps/search/Bún+bò+Mệ+Kéo+Huế"),
    ("Huế", "Quán ăn ngon", "Hạnh Restaurant", "Huế, Thừa Thiên Huế", "Bánh bèo, nậm, lọc, món Huế.", "https://www.google.com/maps/search/Hạnh+Restaurant+Huế"),
    ("Huế", "Cà phê đẹp", "Sline Coffee Signature", "Huế, Thừa Thiên Huế", "Không gian cà phê hiện đại, dễ ngồi.", "https://www.google.com/maps/search/Sline+Coffee+Signature+Huế"),
    ("Huế", "Khám phá", "Đại Nội Huế", "Huế, Thừa Thiên Huế", "Di tích chính, nên đi buổi sáng.", "https://www.google.com/maps/search/Đại+Nội+Huế"),
    ("Huế", "Khám phá", "Lăng Khải Định", "Huế, Thừa Thiên Huế", "Điểm tham quan kiến trúc, chụp ảnh đẹp.", "https://www.google.com/maps/search/Lăng+Khải+Định+Huế"),
    ("Ninh Bình", "Quán ăn ngon", "Nhà hàng Đức Dê", "Ninh Bình", "Dê núi, cơm cháy, món đặc sản.", "https://www.google.com/maps/search/Nhà+hàng+Đức+Dê+Ninh+Bình"),
    ("Ninh Bình", "Quán ăn ngon", "Nhà hàng Thăng Long", "Ninh Bình", "Món địa phương, hợp nhóm đông.", "https://www.google.com/maps/search/Nhà+hàng+Thăng+Long+Ninh+Bình"),
    ("Ninh Bình", "Cà phê đẹp", "Brick Coffee Shop", "Ninh Bình", "Gợi ý cà phê nghỉ chân trong khu vực trung tâm.", "https://www.google.com/maps/search/Brick+Coffee+Shop+Ninh+Bình"),
    ("Ninh Bình", "Khám phá", "Tràng An", "Ninh Bình", "Đi thuyền, hang động, cảnh núi đá vôi.", "https://www.google.com/maps/search/Tràng+An+Ninh+Bình"),
    ("Ninh Bình", "Khám phá", "Hang Múa", "Ninh Bình", "Leo bậc, ngắm toàn cảnh Tam Cốc.", "https://www.google.com/maps/search/Hang+Múa+Ninh+Bình"),
    ("Hà Giang", "Quán ăn ngon", "Nhà hàng Cá Sông Lô", "Hà Giang", "Món địa phương, phù hợp ăn nhóm.", "https://www.google.com/maps/search/Nhà+hàng+Cá+Sông+Lô+Hà+Giang"),
    ("Hà Giang", "Quán ăn ngon", "Cháo ấu tẩu Hà Giang", "Hà Giang", "Món đặc sản, nên hỏi kỹ giờ bán.", "https://www.google.com/maps/search/Cháo+ấu+tẩu+Hà+Giang"),
    ("Hà Giang", "Cà phê đẹp", "Cực Bắc Coffee", "Đồng Văn, Hà Giang", "Cà phê nghỉ chân trên cung Đồng Văn.", "https://www.google.com/maps/search/Cực+Bắc+Coffee+Đồng+Văn"),
    ("Hà Giang", "Khám phá", "Đèo Mã Pì Lèng", "Hà Giang", "Cung đường cảnh quan nổi bật.", "https://www.google.com/maps/search/Đèo+Mã+Pì+Lèng"),
    ("Hà Giang", "Khám phá", "Sông Nho Quế", "Hà Giang", "Đi thuyền, ngắm hẻm Tu Sản.", "https://www.google.com/maps/search/Sông+Nho+Quế"),
    ("Quy Nhơn", "Quán ăn ngon", "Bún cá Ngọc Liên", "Quy Nhơn, Bình Định", "Bún cá, chả cá, món địa phương.", "https://www.google.com/maps/search/Bún+cá+Ngọc+Liên+Quy+Nhơn"),
    ("Quy Nhơn", "Quán ăn ngon", "Bánh xèo tôm nhảy Gia Vỹ", "Quy Nhơn, Bình Định", "Bánh xèo tôm nhảy, phù hợp ăn nhẹ.", "https://www.google.com/maps/search/Bánh+xèo+tôm+nhảy+Gia+Vỹ+Quy+Nhơn"),
    ("Quy Nhơn", "Cà phê đẹp", "Surf Bar Quy Nhơn", "Quy Nhơn, Bình Định", "Không gian ven biển, hợp chiều tối.", "https://www.google.com/maps/search/Surf+Bar+Quy+Nhơn"),
    ("Quy Nhơn", "Khám phá", "Kỳ Co", "Quy Nhơn, Bình Định", "Biển, cano, tour trong ngày.", "https://www.google.com/maps/search/Kỳ+Co+Quy+Nhơn"),
    ("Quy Nhơn", "Khám phá", "Eo Gió", "Quy Nhơn, Bình Định", "Điểm ngắm biển, chụp ảnh.", "https://www.google.com/maps/search/Eo+Gió+Quy+Nhơn"),
    ("Cần Thơ", "Quán ăn ngon", "Lẩu mắm Dạ Lý", "Cần Thơ", "Lẩu mắm miền Tây, hợp nhóm đông.", "https://www.google.com/maps/search/Lẩu+mắm+Dạ+Lý+Cần+Thơ"),
    ("Cần Thơ", "Quán ăn ngon", "Bánh xèo 7 Tới", "Cần Thơ", "Bánh xèo, món miền Tây.", "https://www.google.com/maps/search/Bánh+xèo+7+Tới+Cần+Thơ"),
    ("Cần Thơ", "Cà phê đẹp", "Cafe 1985 Cần Thơ", "Cần Thơ", "Không gian cà phê nghỉ chân.", "https://www.google.com/maps/search/Cafe+1985+Cần+Thơ"),
    ("Cần Thơ", "Khám phá", "Chợ nổi Cái Răng", "Cần Thơ", "Đi sáng sớm, trải nghiệm sông nước.", "https://www.google.com/maps/search/Chợ+nổi+Cái+Răng"),
    ("Cần Thơ", "Khám phá", "Nhà cổ Bình Thủy", "Cần Thơ", "Điểm văn hóa, chụp ảnh, tham quan ngắn.", "https://www.google.com/maps/search/Nhà+cổ+Bình+Thủy"),
]


def init_schema():
    with db_cursor(commit=True) as cursor:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS travel_users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'viewer')),
                display_name VARCHAR(255) NOT NULL DEFAULT '',
                active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS trips (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                owner_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                destination_id INTEGER,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS travel_destinations (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL UNIQUE,
                active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS travel_suggestions (
                id SERIAL PRIMARY KEY,
                destination_id INTEGER NOT NULL REFERENCES travel_destinations(id) ON DELETE CASCADE,
                category VARCHAR(80) NOT NULL,
                name VARCHAR(255) NOT NULL,
                address TEXT NOT NULL DEFAULT '',
                phone VARCHAR(80) NOT NULL DEFAULT '',
                opening_hours TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                map_url TEXT NOT NULL DEFAULT '',
                source_url TEXT NOT NULL DEFAULT '',
                active BOOLEAN NOT NULL DEFAULT TRUE,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (destination_id, category, name)
            );

            CREATE TABLE IF NOT EXISTS trip_admin_permissions (
                id SERIAL PRIMARY KEY,
                trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (trip_id, admin_id)
            );

            CREATE TABLE IF NOT EXISTS travel_people (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL DEFAULT '',
                client_id INTEGER REFERENCES user_clients(id) ON DELETE SET NULL,
                owner_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS trip_members (
                id SERIAL PRIMARY KEY,
                trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                person_id INTEGER REFERENCES travel_people(id) ON DELETE SET NULL,
                client_id INTEGER REFERENCES user_clients(id) ON DELETE SET NULL,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL DEFAULT '',
                active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS trip_collections (
                id SERIAL PRIMARY KEY,
                trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                member_id INTEGER NOT NULL REFERENCES trip_members(id) ON DELETE CASCADE,
                amount NUMERIC(14, 0) NOT NULL DEFAULT 0,
                note TEXT NOT NULL DEFAULT '',
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (trip_id, member_id)
            );

            CREATE TABLE IF NOT EXISTS trip_expenses (
                id SERIAL PRIMARY KEY,
                trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                spent_date DATE NOT NULL DEFAULT CURRENT_DATE,
                title VARCHAR(255) NOT NULL,
                amount NUMERIC(14, 0) NOT NULL CHECK (amount >= 0),
                note TEXT NOT NULL DEFAULT '',
                split_mode VARCHAR(20) NOT NULL DEFAULT 'shared',
                private_member_id INTEGER REFERENCES trip_members(id) ON DELETE SET NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS trip_expense_splits (
                id SERIAL PRIMARY KEY,
                expense_id INTEGER NOT NULL REFERENCES trip_expenses(id) ON DELETE CASCADE,
                member_id INTEGER NOT NULL REFERENCES trip_members(id) ON DELETE CASCADE,
                amount NUMERIC(14, 0) NOT NULL DEFAULT 0 CHECK (amount >= 0),
                UNIQUE (expense_id, member_id)
            );

            DO $$
            BEGIN
                IF to_regclass('public.user_clients') IS NULL AND to_regclass('public.van_dong_vien') IS NOT NULL THEN
                    ALTER TABLE van_dong_vien RENAME TO user_clients;
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_clients' AND column_name = 'ten_vdv') THEN
                    ALTER TABLE user_clients RENAME COLUMN ten_vdv TO display_name;
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_clients' AND column_name = 'trinh_do') THEN
                    ALTER TABLE user_clients RENAME COLUMN trinh_do TO skill_level;
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_clients' AND column_name = 'ghi_chu') THEN
                    ALTER TABLE user_clients RENAME COLUMN ghi_chu TO notes;
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'travel_people' AND column_name = 'user_id') THEN
                    ALTER TABLE travel_people RENAME COLUMN user_id TO client_id;
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trip_members' AND column_name = 'user_id') THEN
                    ALTER TABLE trip_members RENAME COLUMN user_id TO client_id;
                END IF;
            END $$;

            CREATE TABLE IF NOT EXISTS user_clients (
                id SERIAL PRIMARY KEY,
                display_name VARCHAR(255) NOT NULL,
                skill_level VARCHAR(10) DEFAULT 'C',
                email VARCHAR(255) NOT NULL DEFAULT '',
                notes TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        cursor.execute("ALTER TABLE trip_members ADD COLUMN IF NOT EXISTS person_id INTEGER REFERENCES travel_people(id) ON DELETE SET NULL;")
        cursor.execute("ALTER TABLE trips ADD COLUMN IF NOT EXISTS destination_id INTEGER REFERENCES travel_destinations(id) ON DELETE SET NULL;")
        cursor.execute("ALTER TABLE trips ADD COLUMN IF NOT EXISTS treasurer_member_id INTEGER REFERENCES trip_members(id) ON DELETE SET NULL;")
        cursor.execute("ALTER TABLE travel_suggestions ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;")
        cursor.execute(
            """
            UPDATE travel_suggestions
            SET active = FALSE,
                updated_at = CURRENT_TIMESTAMP
            WHERE active = TRUE
              AND (
                  source_url LIKE %s
                  OR map_url LIKE %s
              );
            """,
            ("https://www.openstreetmap.org/%", "https://www.openstreetmap.org/%"),
        )
        cursor.execute("ALTER TABLE trip_expenses ADD COLUMN IF NOT EXISTS split_mode VARCHAR(20) NOT NULL DEFAULT 'shared';")
        cursor.execute("ALTER TABLE trip_expenses ADD COLUMN IF NOT EXISTS private_member_id INTEGER REFERENCES trip_members(id) ON DELETE SET NULL;")
        cursor.execute("ALTER TABLE trip_expenses ADD COLUMN IF NOT EXISTS paid_by_member_id INTEGER REFERENCES trip_members(id) ON DELETE SET NULL;")
        cursor.execute(
            """
            UPDATE trip_expenses e
            SET split_mode = 'private',
                private_member_id = single_split.member_id
            FROM (
                SELECT expense_id,
                       MIN(member_id) FILTER (WHERE amount > 0) AS member_id,
                       SUM(amount) AS split_total,
                       COUNT(*) FILTER (WHERE amount > 0) AS positive_count
                FROM trip_expense_splits
                GROUP BY expense_id
            ) single_split
            WHERE e.id = single_split.expense_id
              AND e.split_mode = 'shared'
              AND single_split.positive_count = 1
              AND single_split.split_total = e.amount;
            """
        )
        cursor.execute(
            """
            UPDATE trips
            SET destination_id = NULL
            WHERE destination_id IN (
                SELECT id
                FROM travel_destinations
                WHERE char_length(name) = 1
            );
            """
        )
        cursor.execute(
            """
            DELETE FROM travel_destinations
            WHERE char_length(name) = 1
              AND NOT EXISTS (
                  SELECT 1 FROM travel_suggestions s WHERE s.destination_id = travel_destinations.id
              );
            """
        )
        cursor.executemany(
            """
            INSERT INTO travel_destinations (name)
            VALUES (%s)
            ON CONFLICT (name) DO UPDATE SET active = TRUE, updated_at = CURRENT_TIMESTAMP;
            """,
            [(name,) for name in sorted({row[0] for row in DESTINATION_SUGGESTION_SEED})],
        )
        cursor.executemany(
            """
            INSERT INTO travel_suggestions (
                destination_id, category, name, address, description, map_url, sort_order
            )
            SELECT d.id, %s, %s, %s, %s, %s, %s
            FROM travel_destinations d
            WHERE d.name = %s
            ON CONFLICT (destination_id, category, name) DO NOTHING;
            """,
            [
                (category, name, address, description, map_url, index, destination)
                for index, (destination, category, name, address, description, map_url) in enumerate(DESTINATION_SUGGESTION_SEED, start=1)
            ],
        )
        cursor.execute(
            """
            DO $$
            DECLARE
                fk record;
            BEGIN
                FOR fk IN
                    SELECT tc.table_name, tc.constraint_name
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage kcu
                      ON tc.constraint_name = kcu.constraint_name
                     AND tc.table_schema = kcu.table_schema
                    WHERE tc.constraint_type = 'FOREIGN KEY'
                      AND tc.table_schema = 'public'
                      AND tc.table_name IN ('trips', 'trip_admin_permissions', 'travel_people', 'trip_members')
                      AND kcu.column_name IN ('owner_admin_id', 'admin_id', 'user_id', 'client_id')
                LOOP
                    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', fk.table_name, fk.constraint_name);
                END LOOP;
            END $$;

            INSERT INTO users (id, email, password, role)
            SELECT tu.id, split_part(lower(tu.email), '@', 1), tu.password_hash, 'admin'
            FROM travel_users tu
            WHERE tu.role = 'admin'
              AND NOT EXISTS (
                  SELECT 1
                  FROM users u
                  WHERE lower(u.email) = split_part(lower(tu.email), '@', 1)
                     OR u.id = tu.id
              );

            SELECT setval(
                pg_get_serial_sequence('users', 'id'),
                GREATEST(COALESCE((SELECT MAX(id) FROM users), 1), 1),
                true
            );

            UPDATE trips t
            SET owner_admin_id = u.id
            FROM travel_users tu
            INNER JOIN users u ON lower(u.email) = split_part(lower(tu.email), '@', 1)
            WHERE t.owner_admin_id = tu.id
              AND tu.role = 'admin';

            UPDATE trip_admin_permissions p
            SET admin_id = u.id
            FROM travel_users tu
            INNER JOIN users u ON lower(u.email) = split_part(lower(tu.email), '@', 1)
            WHERE p.admin_id = tu.id
              AND tu.role = 'admin';

            UPDATE travel_people p
            SET owner_admin_id = u.id
            FROM travel_users tu
            INNER JOIN users u ON lower(u.email) = split_part(lower(tu.email), '@', 1)
            WHERE p.owner_admin_id = tu.id
              AND tu.role = 'admin';

            INSERT INTO user_clients (display_name, skill_level, email, notes)
            SELECT p.name, 'C', p.email, ''
            FROM travel_people p
            WHERE p.active = TRUE
              AND p.email <> ''
              AND NOT EXISTS (
                  SELECT 1 FROM user_clients v WHERE lower(v.email) = lower(p.email)
              );

            INSERT INTO travel_people (name, email, client_id, owner_admin_id)
            SELECT v.display_name, v.email, v.id,
                   (SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1)
            FROM user_clients v
            WHERE NOT EXISTS (
                SELECT 1
                FROM travel_people p
                WHERE p.active = TRUE
                  AND (
                    (p.email <> '' AND lower(p.email) = lower(v.email))
                    OR (p.email = '' AND lower(p.name) = lower(v.display_name))
                  )
            );

            UPDATE travel_people p
            SET client_id = v.id
            FROM user_clients v
            WHERE p.email <> ''
              AND lower(p.email) = lower(v.email);

            UPDATE trip_members tm
            SET client_id = v.id
            FROM user_clients v
            WHERE tm.email <> ''
              AND lower(tm.email) = lower(v.email);

            INSERT INTO travel_people (name, email, client_id, owner_admin_id)
            SELECT DISTINCT ON (lower(trim(tm.name)), lower(trim(tm.email)))
                   tm.name, COALESCE(tm.email, ''), tm.client_id, t.owner_admin_id
            FROM trip_members tm
            INNER JOIN trips t ON tm.trip_id = t.id
            WHERE tm.active = TRUE
              AND tm.person_id IS NULL
              AND NOT EXISTS (
                  SELECT 1
                  FROM travel_people p
                  WHERE lower(trim(p.name)) = lower(trim(tm.name))
                    AND lower(trim(p.email)) = lower(trim(COALESCE(tm.email, '')))
                    AND p.active = TRUE
              )
            ORDER BY lower(trim(tm.name)), lower(trim(tm.email)), tm.id;
            """
        )
        cursor.execute(
            """
            UPDATE trip_members tm
            SET person_id = p.id
            FROM travel_people p
            WHERE tm.person_id IS NULL
              AND lower(trim(p.name)) = lower(trim(tm.name))
              AND lower(trim(p.email)) = lower(trim(COALESCE(tm.email, '')))
              AND p.active = TRUE;
            """
        )
        cursor.execute(
            """
            UPDATE trip_members tm
            SET client_id = v.id
            FROM user_clients v
            WHERE tm.client_id IS NULL
              AND tm.email <> ''
              AND lower(tm.email) = lower(v.email)
              AND tm.active = TRUE;
            """
        )
        cursor.execute(
            """
            UPDATE travel_people p
            SET client_id = v.id
            FROM user_clients v
            WHERE p.client_id IS NULL
              AND p.email <> ''
              AND lower(p.email) = lower(v.email)
              AND p.active = TRUE;
            """
        )
        cursor.execute(
            """
            UPDATE travel_users u
            SET email = split_part(lower(u.email), '@', 1)
            WHERE u.role = 'admin'
              AND position('@' IN u.email) > 0
              AND NOT EXISTS (
                  SELECT 1
                  FROM travel_users other
                  WHERE other.id <> u.id
                    AND lower(other.email) = split_part(lower(u.email), '@', 1)
              );
            """
        )
        cursor.execute(
            """
            INSERT INTO travel_users (email, password_hash, role, display_name)
            VALUES (%s, %s, 'admin', 'Admin')
            ON CONFLICT (email) DO NOTHING;
            """,
            (SUPER_ADMIN_EMAIL, AuthService.hash_password(DEFAULT_ADMIN_PASSWORD)),
        )
