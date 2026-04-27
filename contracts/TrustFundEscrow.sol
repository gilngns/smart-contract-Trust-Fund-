// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

// ============================================================
//  OpenZeppelin Upgradeable Contracts (v5.x)
//  Install: npm install @openzeppelin/contracts-upgradeable
// ============================================================
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title  TrustFundEscrow
 * @author TrustFund Engineering
 * @notice Brankas escrow berbasis XIDR (Stablecoin Rupiah, Polygon) untuk platform
 *         crowdfunding TrustFund. Semua interaksi dieksekusi oleh backend relayer —
 *         donatur dan yayasan tidak perlu memiliki wallet Web3.
 *
 * @dev    Arsitektur:
 *         - UUPS Proxy Pattern  : contract bisa di-upgrade tanpa kehilangan state
 *         - Role-Based AC       : BACKEND_ROLE (relayer) & ORACLE_ROLE (AI validator)
 *         - State Machine       : setiap kampanye melewati siklus state yang ketat
 *         - Pull-over-Push      : dana selalu ditransfer ke backend wallet, bukan
 *                                 langsung ke yayasan, untuk menghindari reentrancy
 *                                 dan menyederhanakan compliance off-chain (swap XIDR→IDR)
 *
 * ┌──────────────────────────────────────────────────────────┐
 * │              SIKLUS STATE KAMPANYE                       │
 * │                                                          │
 * │  ACTIVE ──deposit──► FUNDED ──oracleCallback(advance)──► │
 * │  ADVANCE_PAID ──submit──► MILESTONE_SUBMITTED            │
 * │    ──oracleCallback(pass)──► VALIDATED                   │
 * │      ──releaseMilestone──► ACTIVE / COMPLETED            │
 * │                                                          │
 * │  Dari state apapun ──oracleCallback(fraud)──► FROZEN     │
 * │  FROZEN ──triggerRefund──► COMPLETED (refunded)          │
 * └──────────────────────────────────────────────────────────┘
 */
contract TrustFundEscrow is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    // =========================================================
    // SECTION 1 — ROLES & CONSTANTS
    // =========================================================

    /// @notice Role untuk backend relayer (admin utama sistem TrustFund)
    bytes32 public constant BACKEND_ROLE = keccak256("BACKEND_ROLE");

    /// @notice Role untuk sistem AI oracle yang memvalidasi dokumen dan milestone
    bytes32 public constant ORACLE_ROLE  = keccak256("ORACLE_ROLE");

    /// @notice Role untuk upgrade contract (dipisah dari BACKEND_ROLE demi keamanan)
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    // =========================================================
    // SECTION 2 — STATE MACHINE
    // =========================================================

    /**
     * @notice Siklus hidup sebuah kampanye crowdfunding.
     *
     * ACTIVE              : Kampanye dibuat, siap menerima donasi.
     * FUNDED              : Target donasi terpenuhi; dana terkunci, menunggu
     *                       advance payment disetujui.
     * ADVANCE_PAID        : Uang muka (advance) telah dirilis ke backend.
     *                       Yayasan sedang mengerjakan tahap awal.
     * MILESTONE_SUBMITTED : Yayasan mengklaim milestone selesai (via backend).
     *                       Menunggu validasi oracle.
     * VALIDATED           : Oracle menyatakan milestone lolos. Dana milestone
     *                       siap untuk dirilis.
     * FROZEN              : Oracle mendeteksi indikasi fraud. Dana dikunci keras;
     *                       hanya triggerRefund yang bisa dipanggil.
     * COMPLETED           : Semua milestone selesai ATAU refund telah dieksekusi.
     *                       Kampanye berakhir.
     */
    enum CampaignState {
        ACTIVE,
        FUNDED,
        ADVANCE_PAID,
        MILESTONE_SUBMITTED,
        VALIDATED,
        FROZEN,
        COMPLETED
    }

    // =========================================================
    // SECTION 3 — STRUCT & STORAGE
    // =========================================================

    /**
     * @notice Data utama setiap kampanye yang disimpan on-chain.
     * @dev    Disusun untuk mengoptimalkan slot storage (packing):
     *         - uint128 dipilih karena XIDR memiliki 6 desimal; nilai max
     *           ~340 triliun XIDR jauh melampaui kebutuhan praktis.
     *         - uint32 untuk milestoneAmount (maks 4 miliar unit) cukup.
     *         - state (enum = uint8) + currentMilestone + totalMilestones
     *           dikemas dalam satu slot bersama campaignId yang truncated.
     *
     *         Layout slot (estimasi):
     *         slot 0: campaignId (bytes32)
     *         slot 1: targetAmount (uint128) + totalCollected (uint128)
     *         slot 2: milestoneAmount (uint128) + advanceAmount (uint128)
     *         slot 3: totalMilestones (uint8) + currentMilestone (uint8) +
     *                 state (uint8) + createdAt (uint32) — packed
     */
    struct Campaign {
        bytes32 campaignId;      // ID unik dari database backend (bytes32 hemat gas vs string)
        uint128 targetAmount;    // Target donasi dalam satuan terkecil XIDR (6 desimal)
        uint128 totalCollected;  // Total XIDR yang sudah masuk ke contract
        uint128 milestoneAmount; // Jumlah XIDR per milestone yang dirilis
        uint128 advanceAmount;   // Jumlah XIDR advance payment (uang muka)
        uint32  createdAt;       // Unix timestamp pembuatan (cukup uint32 s/d tahun 2106)
        uint8   totalMilestones; // Total jumlah milestone kampanye
        uint8   currentMilestone;// Milestone yang sedang berjalan (0-indexed)
        CampaignState state;     // State saat ini
    }

    // =========================================================
    // SECTION 4 — STATE VARIABLES
    // =========================================================

    /// @notice Token XIDR (ERC-20 Stablecoin Rupiah) di Polygon
    IERC20 public xidr;

    /// @notice Wallet backend yang menjadi relayer dan penerima dana released/refund
    address public backendWallet;

    /// @notice Mapping dari campaignId → data kampanye
    mapping(bytes32 => Campaign) private campaigns;

    /// @notice Mapping dari campaignId → saldo XIDR yang terkunci di contract ini
    mapping(bytes32 => uint256) public lockedFunds;

    // =========================================================
    // SECTION 5 — EVENTS
    // =========================================================

    /**
     * @notice Dipancarkan ketika kampanye baru dibuat.
     * @param campaignId    ID kampanye (sesuai database backend)
     * @param targetAmount  Target donasi dalam satuan XIDR terkecil
     * @param totalMilestones Jumlah milestone
     */
    event CampaignCreated(
        bytes32 indexed campaignId,
        uint256 targetAmount,
        uint8   totalMilestones
    );

    /**
     * @notice Dipancarkan setiap kali backend men-deposit XIDR ke kampanye.
     * @param campaignId    ID kampanye
     * @param amount        Jumlah XIDR yang dideposit (satuan terkecil)
     * @param totalCollected Total akumulasi XIDR di kampanye ini
     * @param isFunded      true jika deposit ini memenuhi/melebihi target
     */
    event FundsDeposited(
        bytes32 indexed campaignId,
        uint256 amount,
        uint256 totalCollected,
        bool    isFunded
    );

    /**
     * @notice Dipancarkan ketika oracle memberikan hasil validasi.
     * @param campaignId    ID kampanye
     * @param milestone     Milestone yang divalidasi
     * @param validated     true = lolos, false = fraud detected
     * @param score         Skor validasi dari AI (0-100)
     */
    event OracleValidated(
        bytes32 indexed campaignId,
        uint8   milestone,
        bool    validated,
        uint8   score
    );

    /**
     * @notice Dipancarkan ketika advance payment dirilis ke backend.
     * @param campaignId    ID kampanye
     * @param amount        Jumlah XIDR yang dirilis
     * @param recipient     Alamat penerima (backend wallet)
     */
    event AdvanceReleased(
        bytes32 indexed campaignId,
        uint256 amount,
        address recipient
    );

    /**
     * @notice Dipancarkan ketika dana milestone dirilis ke backend.
     * @param campaignId    ID kampanye
     * @param milestone     Nomor milestone yang dirilis
     * @param amount        Jumlah XIDR yang dirilis
     * @param recipient     Alamat penerima (backend wallet)
     * @param isCompleted   true jika ini milestone terakhir
     */
    event MilestoneReleased(
        bytes32 indexed campaignId,
        uint8   milestone,
        uint256 amount,
        address recipient,
        bool    isCompleted
    );

    /**
     * @notice Dipancarkan ketika state kampanye berubah.
     * @param campaignId  ID kampanye
     * @param oldState    State sebelumnya
     * @param newState    State baru
     */
    event CampaignStateChanged(
        bytes32      indexed campaignId,
        CampaignState        oldState,
        CampaignState        newState
    );

    /**
     * @notice Dipancarkan ketika refund dieksekusi akibat deteksi fraud.
     * @param campaignId  ID kampanye
     * @param amount      Total XIDR yang dikembalikan ke backend
     * @param recipient   Alamat penerima refund (backend wallet)
     */
    event RefundTriggered(
        bytes32 indexed campaignId,
        uint256 amount,
        address recipient
    );

    /**
     * @notice Dipancarkan ketika backend wallet diganti.
     * @param oldWallet   Alamat backend wallet lama
     * @param newWallet   Alamat backend wallet baru
     */
    event BackendWalletUpdated(address oldWallet, address newWallet);

    // =========================================================
    // SECTION 6 — CUSTOM ERRORS (lebih hemat gas vs string revert)
    // =========================================================

    error CampaignAlreadyExists(bytes32 campaignId);
    error CampaignNotFound(bytes32 campaignId);
    error InvalidState(bytes32 campaignId, CampaignState current, CampaignState required);
    error InvalidAmount(uint256 provided, string reason);
    error InvalidMilestoneConfig(string reason);
    error ZeroAddress();
    error TransferFailed();
    error InsufficientLockedFunds(bytes32 campaignId, uint256 available, uint256 requested);
    error MilestoneAlreadyCompleted(bytes32 campaignId);

    // =========================================================
    // SECTION 7 — MODIFIERS
    // =========================================================

    /**
     * @dev Memastikan campaign dengan `campaignId` sudah ada.
     */
    modifier campaignExists(bytes32 campaignId) {
        if (campaigns[campaignId].createdAt == 0) {
            revert CampaignNotFound(campaignId);
        }
        _;
    }

    /**
     * @dev Memastikan campaign berada pada state yang diharapkan.
     */
    modifier inState(bytes32 campaignId, CampaignState expected) {
        CampaignState current = campaigns[campaignId].state;
        if (current != expected) {
            revert InvalidState(campaignId, current, expected);
        }
        _;
    }

    // =========================================================
    // SECTION 8 — INITIALIZER (menggantikan constructor)
    // =========================================================

    /**
     * @notice Inisialisasi contract (dipanggil sekali saat deploy proxy).
     * @dev    Menggunakan pola initializer OpenZeppelin untuk UUPS.
     *         Semua `__X_init()` harus dipanggil di sini.
     *
     * @param _xidrToken      Alamat contract token XIDR di Polygon
     * @param _backendWallet  Alamat hot wallet backend relayer
     * @param _admin          Alamat super-admin (idealnya multisig)
     */
    function initialize(
        address _xidrToken,
        address _backendWallet,
        address _admin
    ) external initializer {
        // Validasi input dasar
        if (_xidrToken == address(0) || _backendWallet == address(0) || _admin == address(0)) {
            revert ZeroAddress();
        }

        // Init semua parent contracts (urutan penting!)
        __UUPSUpgradeable_init();
        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        // Set token XIDR
        xidr = IERC20(_xidrToken);
        backendWallet = _backendWallet;

        // Assign roles:
        // DEFAULT_ADMIN_ROLE bisa grant/revoke semua role — gunakan multisig!
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(UPGRADER_ROLE, _admin);
        _grantRole(BACKEND_ROLE, _backendWallet);
    }

    // =========================================================
    // SECTION 9 — CORE FUNCTIONS
    // =========================================================

    /**
     * @notice Membuat kampanye baru (brankas baru) di contract.
     * @dev    Hanya bisa dipanggil oleh BACKEND_ROLE.
     *         Backend menginisialisasi campaign ini setelah KYC yayasan
     *         selesai diverifikasi di sisi Web2.
     *
     *         Gas optimization: bytes32 campaignId jauh lebih hemat dari string.
     *         Backend harus mengkonversi UUID/slug ke bytes32 sebelum memanggil
     *         fungsi ini (contoh: keccak256(abi.encodePacked("campaign-slug"))).
     *
     * @param campaignId       ID unik (bytes32) dari database backend
     * @param targetAmount     Target total donasi dalam satuan XIDR terkecil (6 desimal)
     * @param advanceAmount    Jumlah advance payment saat FUNDED (boleh 0)
     * @param milestoneAmount  Jumlah XIDR per milestone
     * @param totalMilestones  Total jumlah milestone (min 1, max 20)
     */
    function createCampaign(
        bytes32 campaignId,
        uint128 targetAmount,
        uint128 advanceAmount,
        uint128 milestoneAmount,
        uint8   totalMilestones
    )
        external
        onlyRole(BACKEND_ROLE)
        whenNotPaused
    {
        // Cegah duplikat
        if (campaigns[campaignId].createdAt != 0) {
            revert CampaignAlreadyExists(campaignId);
        }

        // Validasi konfigurasi
        if (targetAmount == 0) revert InvalidAmount(targetAmount, "target cannot be zero");
        if (totalMilestones == 0 || totalMilestones > 20) {
            revert InvalidMilestoneConfig("totalMilestones must be 1-20");
        }

        // Validasi bahwa advance + (milestones * milestoneAmount) <= targetAmount
        // Ini mencegah konfigurasi yang akan melebihi dana terkumpul
        uint256 totalPayout = uint256(advanceAmount) + (uint256(milestoneAmount) * totalMilestones);
        if (totalPayout > targetAmount) {
            revert InvalidMilestoneConfig("payout config exceeds targetAmount");
        }

        // Simpan data kampanye
        campaigns[campaignId] = Campaign({
            campaignId:       campaignId,
            targetAmount:     targetAmount,
            totalCollected:   0,
            milestoneAmount:  milestoneAmount,
            advanceAmount:    advanceAmount,
            createdAt:        uint32(block.timestamp),
            totalMilestones:  totalMilestones,
            currentMilestone: 0,
            state:            CampaignState.ACTIVE
        });

        emit CampaignCreated(campaignId, targetAmount, totalMilestones);
    }

    /**
     * @notice Menyetor XIDR ke dalam brankas kampanye.
     * @dev    Dipanggil backend setiap kali ada donasi masuk via QRIS/transfer Web2.
     *         Flow: User bayar QRIS → Backend swap IDR→XIDR → Backend panggil fungsi ini.
     *
     *         Fungsi menggunakan `transferFrom`, sehingga backend wallet HARUS sudah
     *         memanggil `xidr.approve(address(this), amount)` sebelumnya.
     *
     *         Jika deposit ini memenuhi atau melebihi targetAmount, state otomatis
     *         berpindah ke FUNDED — backend akan mendapat notifikasi via event.
     *
     * @param campaignId  ID kampanye tujuan
     * @param amount      Jumlah XIDR yang dideposit (satuan terkecil)
     */
    function depositXIDR(bytes32 campaignId, uint128 amount)
        external
        onlyRole(BACKEND_ROLE)
        whenNotPaused
        campaignExists(campaignId)
        nonReentrant
    {
        Campaign storage campaign = campaigns[campaignId];

        // Deposit hanya diizinkan saat ACTIVE
        if (campaign.state != CampaignState.ACTIVE) {
            revert InvalidState(campaignId, campaign.state, CampaignState.ACTIVE);
        }

        if (amount == 0) revert InvalidAmount(amount, "amount cannot be zero");

        // Tarik XIDR dari wallet backend ke contract ini
        // transferFrom akan revert otomatis jika gagal (allowance tidak cukup, dll.)
        bool success = xidr.transferFrom(msg.sender, address(this), amount);
        if (!success) revert TransferFailed();

        // Update saldo terkumpul (unchecked aman karena uint128 max >> kebutuhan praktis)
        unchecked {
            campaign.totalCollected += amount;
            lockedFunds[campaignId] += amount;
        }

        bool isFunded = campaign.totalCollected >= campaign.targetAmount;

        // Transisi state otomatis jika target terpenuhi
        if (isFunded) {
            _changeState(campaign, CampaignState.FUNDED);
        }

        emit FundsDeposited(
            campaignId,
            amount,
            campaign.totalCollected,
            isFunded
        );
    }

    /**
     * @notice Menerima hasil validasi dari sistem AI oracle.
     * @dev    Oracle dipanggil oleh sistem AI backend setelah menganalisis
     *         dokumen/laporan yang disubmit yayasan.
     *
     *         Logika state transition:
     *         - FUNDED + validated=true  → VALIDATED (siap advance payment)
     *         - MILESTONE_SUBMITTED + validated=true  → VALIDATED (siap milestone release)
     *         - State apapun + validated=false → FROZEN (fraud detected, kunci keras)
     *
     *         Score adalah skor kepercayaan AI (0-100); disimpan di event untuk
     *         audit trail off-chain. Threshold kelulusan ditentukan off-chain
     *         oleh sistem AI — contract hanya terima keputusan final (bool).
     *
     * @param campaignId  ID kampanye yang sedang divalidasi
     * @param validated   true = lolos validasi, false = indikasi fraud
     * @param score       Skor kepercayaan AI (0-100, untuk audit trail)
     */
    function oracleCallback(bytes32 campaignId, bool validated, uint8 score)
        external
        onlyRole(ORACLE_ROLE)
        whenNotPaused
        campaignExists(campaignId)
    {
        Campaign storage campaign = campaigns[campaignId];

        // Validasi bisa masuk dari state FUNDED atau MILESTONE_SUBMITTED
        bool isValidState = (
            campaign.state == CampaignState.FUNDED ||
            campaign.state == CampaignState.MILESTONE_SUBMITTED
        );

        // Fraud bisa dideteksi dari state APAPUN kecuali COMPLETED
        if (!validated) {
            if (campaign.state == CampaignState.COMPLETED) {
                revert InvalidState(campaignId, campaign.state, CampaignState.FROZEN);
            }
            // Freeze segera
            _changeState(campaign, CampaignState.FROZEN);
            emit OracleValidated(campaignId, campaign.currentMilestone, false, score);
            return;
        }

        // Untuk validasi positif, state sumber harus FUNDED atau MILESTONE_SUBMITTED
        if (!isValidState) {
            revert InvalidState(campaignId, campaign.state, CampaignState.FUNDED);
        }

        _changeState(campaign, CampaignState.VALIDATED);

        emit OracleValidated(campaignId, campaign.currentMilestone, true, score);
    }

    /**
     * @notice Merilis advance payment (uang muka) ke wallet backend.
     * @dev    Hanya bisa dipanggil saat state VALIDATED dan currentMilestone == 0
     *         (artinya ini adalah release pertama, yaitu advance).
     *         Setelah advance dirilis, state berpindah ke ADVANCE_PAID.
     *
     *         Backend kemudian menukar XIDR → IDR dan mentransfer ke rekening yayasan.
     *
     * @param campaignId  ID kampanye yang advance-nya akan dirilis
     */
    function releaseAdvance(bytes32 campaignId)
        external
        onlyRole(BACKEND_ROLE)
        whenNotPaused
        campaignExists(campaignId)
        inState(campaignId, CampaignState.VALIDATED)
        nonReentrant
    {
        Campaign storage campaign = campaigns[campaignId];

        // releaseAdvance hanya valid sebelum milestone pertama dimulai
        if (campaign.currentMilestone != 0) {
            revert InvalidMilestoneConfig("advance already released");
        }

        uint256 amount = campaign.advanceAmount;

        // Jika advanceAmount = 0, skip release dan langsung ke ADVANCE_PAID
        // (beberapa kampanye mungkin tidak punya advance payment)
        if (amount > 0) {
            if (lockedFunds[campaignId] < amount) {
                revert InsufficientLockedFunds(campaignId, lockedFunds[campaignId], amount);
            }

            unchecked {
                lockedFunds[campaignId] -= amount;
            }

            // Transfer XIDR ke backend wallet
            bool success = xidr.transfer(backendWallet, amount);
            if (!success) revert TransferFailed();

            emit AdvanceReleased(campaignId, amount, backendWallet);
        }

        _changeState(campaign, CampaignState.ADVANCE_PAID);
    }

    /**
     * @notice Yayasan mengklaim sebuah milestone telah selesai.
     * @dev    Backend memanggil ini setelah yayasan submit laporan di platform Web2.
     *         Fungsi hanya mengubah state ke MILESTONE_SUBMITTED sebagai sinyal
     *         ke oracle untuk memulai validasi.
     *
     * @param campaignId  ID kampanye
     */
    function submitMilestone(bytes32 campaignId)
        external
        onlyRole(BACKEND_ROLE)
        whenNotPaused
        campaignExists(campaignId)
    {
        Campaign storage campaign = campaigns[campaignId];

        // Milestone hanya bisa disubmit dari state ADVANCE_PAID
        if (campaign.state != CampaignState.ADVANCE_PAID) {
            revert InvalidState(campaignId, campaign.state, CampaignState.ADVANCE_PAID);
        }

        if (campaign.currentMilestone >= campaign.totalMilestones) {
            revert MilestoneAlreadyCompleted(campaignId);
        }

        _changeState(campaign, CampaignState.MILESTONE_SUBMITTED);
    }

    /**
     * @notice Merilis dana milestone ke wallet backend setelah oracle validasi.
     * @dev    Hanya bisa dipanggil saat state VALIDATED.
     *         Setiap pemanggilan merilis satu milestone.
     *
     *         Jika ini adalah milestone terakhir:
     *         - State berpindah ke COMPLETED
     *         - Sisa dana (jika ada selisih karena donasi > target) juga dirilis
     *
     *         Jika masih ada milestone berikutnya:
     *         - State kembali ke ADVANCE_PAID (menunggu submit milestone berikutnya)
     *         - currentMilestone di-increment
     *
     * @param campaignId  ID kampanye yang milestone-nya akan dirilis
     */
    function releaseMilestone(bytes32 campaignId)
        external
        onlyRole(BACKEND_ROLE)
        whenNotPaused
        campaignExists(campaignId)
        inState(campaignId, CampaignState.VALIDATED)
        nonReentrant
    {
        Campaign storage campaign = campaigns[campaignId];

        if (campaign.currentMilestone >= campaign.totalMilestones) {
            revert MilestoneAlreadyCompleted(campaignId);
        }

        uint256 amount = campaign.milestoneAmount;
        bool isLastMilestone = (campaign.currentMilestone + 1) >= campaign.totalMilestones;

        // Jika milestone terakhir, release semua sisa dana (termasuk selisih donasi berlebih)
        if (isLastMilestone) {
            amount = lockedFunds[campaignId]; // Bersihkan sisa
        }

        if (lockedFunds[campaignId] < amount) {
            revert InsufficientLockedFunds(campaignId, lockedFunds[campaignId], amount);
        }

        uint8 releasedMilestone;
        unchecked {
            lockedFunds[campaignId] -= amount;
            releasedMilestone = campaign.currentMilestone;
            campaign.currentMilestone += 1;
        }

        // Transfer XIDR ke backend wallet
        bool success = xidr.transfer(backendWallet, amount);
        if (!success) revert TransferFailed();

        emit MilestoneReleased(
            campaignId,
            releasedMilestone,
            amount,
            backendWallet,
            isLastMilestone
        );

        // Transisi state berikutnya
        if (isLastMilestone) {
            _changeState(campaign, CampaignState.COMPLETED);
        } else {
            // Kembali ke ADVANCE_PAID untuk menunggu milestone submit berikutnya
            _changeState(campaign, CampaignState.ADVANCE_PAID);
        }
    }

    /**
     * @notice Mengembalikan semua dana ke wallet backend untuk di-refund ke donatur.
     * @dev    Hanya bisa dipanggil saat state FROZEN (setelah oracle deteksi fraud).
     *         Backend bertanggung jawab mendistribusikan refund ke donatur
     *         secara off-chain (swap XIDR→IDR → transfer ke rekening donatur).
     *
     *         Seluruh saldo yang masih terkunci dikembalikan sekaligus.
     *
     * @param campaignId  ID kampanye yang akan di-refund
     */
    function triggerRefund(bytes32 campaignId)
        external
        onlyRole(BACKEND_ROLE)
        whenNotPaused
        campaignExists(campaignId)
        inState(campaignId, CampaignState.FROZEN)
        nonReentrant
    {
        uint256 refundAmount = lockedFunds[campaignId];

        if (refundAmount == 0) {
            // Tidak ada dana tersisa; langsung complete
            _changeState(campaigns[campaignId], CampaignState.COMPLETED);
            return;
        }

        // Reset locked funds sebelum transfer (checks-effects-interactions pattern)
        lockedFunds[campaignId] = 0;

        // Transfer semua sisa XIDR ke backend wallet
        bool success = xidr.transfer(backendWallet, refundAmount);
        if (!success) revert TransferFailed();

        _changeState(campaigns[campaignId], CampaignState.COMPLETED);

        emit RefundTriggered(campaignId, refundAmount, backendWallet);
    }

    // =========================================================
    // SECTION 10 — ADMIN FUNCTIONS
    // =========================================================

    /**
     * @notice Membekukan semua transaksi contract dalam kondisi darurat.
     * @dev    Hanya DEFAULT_ADMIN_ROLE yang bisa memanggil ini.
     *         Semua fungsi dengan modifier `whenNotPaused` akan revert.
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Membuka kembali transaksi setelah kondisi darurat teratasi.
     * @dev    Hanya DEFAULT_ADMIN_ROLE yang bisa memanggil ini.
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @notice Mengganti alamat backend wallet.
     * @dev    Diperlukan jika backend wallet dikompromikan atau dirotasi.
     *         Backend wallet lama secara otomatis kehilangan BACKEND_ROLE.
     *
     * @param newWallet  Alamat wallet backend baru
     */
    function updateBackendWallet(address newWallet)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (newWallet == address(0)) revert ZeroAddress();

        address oldWallet = backendWallet;

        // Rotasi role: cabut dari lama, grant ke baru
        _revokeRole(BACKEND_ROLE, oldWallet);
        _grantRole(BACKEND_ROLE, newWallet);

        backendWallet = newWallet;

        emit BackendWalletUpdated(oldWallet, newWallet);
    }

    // =========================================================
    // SECTION 11 — VIEW FUNCTIONS
    // =========================================================

    /**
     * @notice Membaca data kampanye secara penuh.
     * @param campaignId  ID kampanye
     * @return            Struct Campaign lengkap
     */
    function getCampaign(bytes32 campaignId)
        external
        view
        campaignExists(campaignId)
        returns (Campaign memory)
    {
        return campaigns[campaignId];
    }

    /**
     * @notice Membaca state saat ini kampanye.
     * @param campaignId  ID kampanye
     * @return            State kampanye
     */
    function getCampaignState(bytes32 campaignId)
        external
        view
        campaignExists(campaignId)
        returns (CampaignState)
    {
        return campaigns[campaignId].state;
    }

    /**
     * @notice Membaca saldo XIDR terkunci untuk kampanye tertentu.
     * @param campaignId  ID kampanye
     * @return            Jumlah XIDR terkunci (satuan terkecil)
     */
    function getLockedFunds(bytes32 campaignId)
        external
        view
        returns (uint256)
    {
        return lockedFunds[campaignId];
    }

    // =========================================================
    // SECTION 12 — INTERNAL HELPERS
    // =========================================================

    /**
     * @dev Helper internal untuk mengubah state kampanye.
     *      Memancarkan event CampaignStateChanged untuk setiap transisi.
     *      Dipusatkan di sini agar tidak ada transisi state yang terlewat event-nya.
     *
     * @param campaign  Storage reference ke Campaign struct
     * @param newState  State baru yang akan diset
     */
    function _changeState(Campaign storage campaign, CampaignState newState) internal {
        CampaignState oldState = campaign.state;
        campaign.state = newState;
        emit CampaignStateChanged(campaign.campaignId, oldState, newState);
    }

    /**
     * @dev Otorisasi upgrade contract. Hanya UPGRADER_ROLE yang bisa melakukan upgrade.
     *      Fungsi ini dipanggil secara internal oleh UUPSUpgradeable saat upgrade.
     *      Memisahkan UPGRADER_ROLE dari DEFAULT_ADMIN_ROLE adalah praktik keamanan
     *      terbaik — idealnya UPGRADER_ROLE dipegang oleh timelock contract.
     *
     * @param newImplementation  Alamat implementasi baru
     */
    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyRole(UPGRADER_ROLE)
    {}

    // =========================================================
    // SECTION 13 — STORAGE GAP (wajib untuk UUPS upgradeable)
    // =========================================================

    /**
     * @dev Storage gap untuk mengakomodasi penambahan state variable
     *      di versi contract berikutnya tanpa merusak storage layout.
     *      Standar OpenZeppelin: sisakan 50 slot.
     *
     *      Saat upgrade V2 menambah variable baru, kurangi ukuran gap ini.
     *      Contoh: tambah 1 variable → ubah gap dari 50 ke 49.
     */
    uint256[50] private __gap;
}
