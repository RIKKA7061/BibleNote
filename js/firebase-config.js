// Firebase 웹 앱 설정 (프로젝트: biblenote-3ef1e)
// 이 값들은 비밀번호가 아니라 "어느 프로젝트인지"를 알려주는 공개 식별자다.
// 실제 보호는 firestore.rules(본인 메모만 읽기/쓰기)가 한다.
export const firebaseConfig = {
  apiKey: 'AIzaSyCPS4994jP0_PW3Nho0rMgAIeaywb0PmLU',
  authDomain: 'biblenote-3ef1e.firebaseapp.com',
  projectId: 'biblenote-3ef1e',
  storageBucket: 'biblenote-3ef1e.firebasestorage.app',
  messagingSenderId: '198972854111',
  appId: '1:198972854111:web:366cc2e77342cf09a030ea',
};

// Google 로그인용 웹 클라이언트 ID (아이폰에서 쓰는 "구글 페이지로 갔다 돌아오기" 로그인용, 공개 값)
// Google Cloud 콘솔 → API 및 서비스 → 사용자 인증 정보 → 이 클라이언트에
// 승인된 리디렉션 URI(https://rikka7061.github.io/BibleNote/ 등)가 등록돼 있어야 한다.
export const googleClientId = '198972854111-uc1dolngdil04dlklteq5g6uqk7a2q0k.apps.googleusercontent.com';
