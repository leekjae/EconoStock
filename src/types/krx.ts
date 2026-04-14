// Index data (KRX/KOSPI/KOSDAQ series)
export interface IndexData {
  BAS_DD: string;
  IDX_CLSS: string;
  IDX_NM: string;
  CLSPRC_IDX: string;
  CMPPREVDD_IDX: string;
  FLUC_RT: string;
  OPNPRC_IDX: string;
  HGPRC_IDX: string;
  LWPRC_IDX: string;
  ACC_TRDVOL: string;
  ACC_TRDVAL: string;
  MKTCAP: string;
}

// Stock daily trade data (KOSPI/KOSDAQ/KONEX)
export interface StockData {
  BAS_DD: string;
  ISU_CD: string;
  ISU_NM: string;
  MKT_NM: string;
  SECT_TP_NM: string;
  TDD_CLSPRC: string;
  CMPPREVDD_PRC: string;
  FLUC_RT: string;
  TDD_OPNPRC: string;
  TDD_HGPRC: string;
  TDD_LWPRC: string;
  ACC_TRDVOL: string;
  ACC_TRDVAL: string;
  MKTCAP: string;
  LIST_SHRS: string;
  // Joined from base info
  SECUGRP_NM?: string;
}

// Stock base info
export interface StockBaseInfo {
  ISU_CD: string;
  ISU_SRT_CD: string;
  ISU_NM: string;
  ISU_ABBRV: string;
  ISU_ENG_NM: string;
  LIST_DD: string;
  MKT_TP_NM: string;
  SECUGRP_NM: string;
  SECT_TP_NM: string;
  KIND_STKCERT_TP_NM: string;
  PARVAL: string;
  LIST_SHRS: string;
}

// ETF data
export interface ETFData {
  BAS_DD: string;
  ISU_CD: string;
  ISU_NM: string;
  TDD_CLSPRC: string;
  CMPPREVDD_PRC: string;
  FLUC_RT: string;
  NAV: string;
  TDD_OPNPRC: string;
  TDD_HGPRC: string;
  TDD_LWPRC: string;
  ACC_TRDVOL: string;
  ACC_TRDVAL: string;
  MKTCAP: string;
  INVSTASST_NETASST_TOTAMT: string;
  LIST_SHRS: string;
  IDX_IND_NM: string;
  OBJ_STKPRC_IDX: string;
  CMPPREVDD_IDX: string;
  FLUC_RT_IDX: string;
}

// ETN data
export interface ETNData {
  BAS_DD: string;
  ISU_CD: string;
  ISU_NM: string;
  TDD_CLSPRC: string;
  CMPPREVDD_PRC: string;
  FLUC_RT: string;
  PER1SECU_INDIC_VAL: string;
  TDD_OPNPRC: string;
  TDD_HGPRC: string;
  TDD_LWPRC: string;
  ACC_TRDVOL: string;
  ACC_TRDVAL: string;
  MKTCAP: string;
  INDIC_VAL_AMT: string;
  LIST_SHRS: string;
  IDX_IND_NM: string;
  OBJ_STKPRC_IDX: string;
  CMPPREVDD_IDX: string;
  FLUC_RT_IDX: string;
}

// ELW data
export interface ELWData {
  BAS_DD: string;
  ISU_CD: string;
  ISU_NM: string;
  TDD_CLSPRC: string;
  CMPPREVDD_PRC: string;
  TDD_OPNPRC: string;
  TDD_HGPRC: string;
  TDD_LWPRC: string;
  ACC_TRDVOL: string;
  ACC_TRDVAL: string;
  MKTCAP: string;
  LIST_SHRS: string;
  ULY_NM: string;
  ULY_PRC: string;
  CMPPREVDD_PRC_ULY: string;
  FLUC_RT_ULY: string;
}

// Gold data
export interface GoldData {
  BAS_DD: string;
  ISU_CD: string;
  ISU_NM: string;
  TDD_CLSPRC: string;
  CMPPREVDD_PRC: string;
  FLUC_RT: string;
  TDD_OPNPRC: string;
  TDD_HGPRC: string;
  TDD_LWPRC: string;
  ACC_TRDVOL: string;
  ACC_TRDVAL: string;
}

// Oil data
export interface OilData {
  BAS_DD: string;
  OIL_NM: string;
  WT_AVG_PRC: string;
  WT_DIS_AVG_PRC: string;
  ACC_TRDVOL: string;
  ACC_TRDVAL: string;
}

export type MarketType = 'ALL' | 'KOSPI' | 'KOSDAQ' | 'KONEX';
export type ProductType = 'ETF' | 'ETN' | 'ELW' | 'GOLD' | 'OIL';
export type SortCriteria = 'FLUC_RT_DESC' | 'FLUC_RT_ASC' | 'ACC_TRDVOL' | 'ACC_TRDVAL' | 'MKTCAP';

export const SECTOR_COLORS: Record<string, string> = {
  '보통주': 'bg-primary/10 text-primary',
  '우선주': 'bg-violet-100 text-violet-700',
  'ETF': 'bg-emerald-100 text-emerald-700',
  'ETN': 'bg-amber-100 text-amber-700',
  'ELW': 'bg-rose-100 text-rose-700',
  'REITs': 'bg-cyan-100 text-cyan-700',
  '스팩': 'bg-orange-100 text-orange-700',
  '수익증권': 'bg-lime-100 text-lime-700',
  '외국주권': 'bg-indigo-100 text-indigo-700',
};

export const KRX_ENDPOINTS = {
  // Index
  krx_index: 'idx/krx_dd_trd',
  kospi_index: 'idx/kospi_dd_trd',
  kosdaq_index: 'idx/kosdaq_dd_trd',
  // Stocks
  stk_trade: 'sto/stk_bydd_trd',
  ksq_trade: 'sto/ksq_bydd_trd',
  knx_trade: 'sto/knx_bydd_trd',
  // Base info
  stk_base: 'sto/stk_isu_base_info',
  ksq_base: 'sto/ksq_isu_base_info',
  knx_base: 'sto/knx_isu_base_info',
  // Products
  etf: 'etp/etf_bydd_trd',
  etn: 'etp/etn_bydd_trd',
  elw: 'etp/elw_bydd_trd',
  oil: 'gen/oil_bydd_trd',
  gold: 'gen/gold_bydd_trd',
} as const;
