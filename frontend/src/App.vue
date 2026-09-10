<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="brand">B2B 발주 관리</div>
      <nav class="nav">
        <RouterLink to="/">Dashboard</RouterLink>
        <span class="nav-label">거래/정산</span>
        <RouterLink to="/orders">거래내역</RouterLink>
        <RouterLink to="/settlements">정산관리</RouterLink>
        <RouterLink to="/receivables">미수금</RouterLink>
        <span class="nav-label">기준정보</span>
        <RouterLink to="/suppliers">매입처 관리</RouterLink>
        <RouterLink to="/products">상품 관리</RouterLink>
        <RouterLink to="/sales-clients">매출처 관리</RouterLink>
        <RouterLink to="/sales-clients">제안가 관리</RouterLink>
        <span class="nav-label">발주관리</span>
        <RouterLink to="/order-imports/new">발주서 업로드</RouterLink>
        <RouterLink to="/order-imports">업로드 내역</RouterLink>
        <RouterLink to="/system">System Status</RouterLink>
      </nav>
    </header>
    <main class="app-main">
      <RouterView />
    </main>
  </div>
</template>
